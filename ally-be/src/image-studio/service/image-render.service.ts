import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { AppConfigService } from 'src/config/config.service';
import { ImageGenerationProviderFactory } from 'src/image-generation/provider/image-generation-provider.factory';
import {
  ImageGenerationProvider,
  ImageGenerationProviderType,
} from 'src/image-generation/interface/image-generation-provider.interface';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import {
  getSlotProfile,
  ImageSlotKind,
} from '../constants/image-slots.constants';
import {
  estimateImageCostUsd,
  IMAGE_STUDIO_FAILED_MESSAGE,
} from '../constants/image-studio.constants';
import {
  GeneratedImage,
  ImageCheckResult,
} from '../entity/generated-image.entity';
import { GeneratedImageRepository } from '../repository/generated-image.repository';
import { ImageAssetService } from './image-asset.service';
import { ImageJudgeService } from './image-judge.service';
import { ImagePostprocessService } from './image-postprocess.service';

export class ImageRenderError extends Error {
  constructor(
    readonly authorMessage: string,
    readonly cause?: unknown,
  ) {
    super(authorMessage);
  }
}

interface ProviderChoice {
  provider: ImageGenerationProvider;
  providerType: string;
  model: string;
}

/** A refusal is the author's to fix; anything else is an outage worth another provider. */
const isContentRefusal = (error: unknown): boolean => {
  const err = error as { code?: string; status?: number; message?: string };
  if (
    err?.code === 'moderation_blocked' ||
    err?.code === 'content_policy_violation'
  ) {
    return true;
  }
  return (
    /safety|blocked|prohibited|policy/i.test(err?.message ?? '') &&
    err?.status === 400
  );
};

const isOutage = (error: unknown): boolean => {
  const status = (error as { status?: number })?.status;
  return (
    status === undefined || status === 429 || status === 408 || status >= 500
  );
};

export interface RenderOutcome {
  patch: Partial<GeneratedImage>;
}

/**
 * Turns one queued `generated_images` row into a stored image: resolve its
 * references, pick the provider for the job (with references → the
 * consistency model; without → the cover model), generate, check, retry once
 * on a failed check, crop and store.
 */
@Injectable()
export class ImageRenderService {
  private readonly logger = LoggerService.getInstance(ImageRenderService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly providerFactory: ImageGenerationProviderFactory,
    private readonly repository: GeneratedImageRepository,
    private readonly assets: ImageAssetService,
    private readonly postprocess: ImagePostprocessService,
    private readonly judge: ImageJudgeService,
    private readonly llmUsage: LlmUsageService,
  ) {}

  /** Reference images for the row, as PNGs, in prompt order. Missing ones are skipped. */
  async loadReferences(row: GeneratedImage): Promise<Buffer[]> {
    const buffers: Buffer[] = [];
    for (const reference of row.references ?? []) {
      try {
        let location: { bucket: string; key: string } | null = null;
        if (reference.imageId) {
          const source = await this.repository.findOne({
            where: { id: reference.imageId },
          });
          if (source?.originalKey && source.tenantId === row.tenantId) {
            location = { bucket: this.assets.bucket, key: source.originalKey };
          }
        } else if (reference.s3Key) {
          location = {
            bucket: reference.s3Bucket ?? this.assets.bucket,
            key: reference.s3Key,
          };
        }
        if (!location) continue;
        buffers.push(
          await this.postprocess.toReference(await this.assets.read(location)),
        );
      } catch (error) {
        this.logger.warn(
          `[IMAGE_STUDIO] image=${row.id} skipped a reference (${reference.role}): ${
            (error as Error)?.message ?? error
          }`,
        );
      }
    }
    return buffers;
  }

  private choose(type: string, model?: string): ProviderChoice | null {
    try {
      const { provider, providerType } = this.providerFactory.getProvider(type);
      return { provider, providerType, model: model || provider.getModel() };
    } catch {
      return null;
    }
  }

  /** Primary route for the job, then the other provider as the outage fallback. */
  routes(hasReferences: boolean): ProviderChoice[] {
    const config = this.configService.imageStudio;
    const primary = hasReferences
      ? this.choose(config.referenceProvider, config.referenceModel)
      : this.choose(config.textProvider, config.textModel);
    const otherType =
      primary?.providerType === ImageGenerationProviderType.GEMINI
        ? ImageGenerationProviderType.OPENAI
        : ImageGenerationProviderType.GEMINI;
    const fallback = this.choose(otherType);
    return [primary, fallback].filter(
      (choice): choice is ProviderChoice => !!choice,
    );
  }

  private async generateOnce(
    row: GeneratedImage,
    prompt: string,
    references: Buffer[],
  ): Promise<{ image: Buffer; choice: ProviderChoice }> {
    const slot = getSlotProfile(row.slotKind as ImageSlotKind);
    const quality = this.configService.imageStudio.quality;
    const routes = this.routes(references.length > 0);
    if (!routes.length) {
      throw new ImageRenderError(
        'Image generation is not set up on this server yet. Ask an administrator.',
      );
    }
    let lastError: unknown;
    for (const choice of routes) {
      const usable = references.slice(0, choice.provider.maxReferences());
      try {
        const image = await choice.provider.generateImage(
          prompt,
          slot.providerSize,
          {
            quality,
            model: choice.model,
            ...(usable.length
              ? {
                  references: usable.map((data) => ({
                    data,
                    mimeType: 'image/png' as const,
                  })),
                }
              : {}),
          },
        );
        void this.llmUsage.record({
          provider: choice.providerType,
          model: choice.model,
          task: LlmTask.IMAGE_STUDIO_IMAGE,
          unit: 'images',
          metadata: {
            feature: 'image-studio',
            imageId: row.id,
            slotKind: row.slotKind,
            styleId: row.styleId,
            references: usable.length,
            quality,
            estimatedCostUsd: estimateImageCostUsd(
              choice.model,
              quality,
              usable.length,
              this.configService.imageStudio.costPerImageUsd,
            ),
          },
        });
        return { image, choice };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `[IMAGE_STUDIO] image=${row.id} provider=${choice.providerType} failed: ${
            (error as Error)?.message ?? error
          }`,
        );
        if (isContentRefusal(error)) {
          throw new ImageRenderError(
            "The image service wouldn't draw this. Try describing the emotion and setting instead of anything graphic.",
            error,
          );
        }
        if (!isOutage(error)) break;
      }
    }
    if (
      lastError instanceof HttpException ||
      lastError instanceof BadRequestException
    ) {
      throw new ImageRenderError(IMAGE_STUDIO_FAILED_MESSAGE, lastError);
    }
    throw new ImageRenderError(
      (lastError as { status?: number })?.status === 429
        ? 'The image service is busy right now. Try again in a minute.'
        : IMAGE_STUDIO_FAILED_MESSAGE,
      lastError,
    );
  }

  async render(row: GeneratedImage): Promise<RenderOutcome> {
    const slot = getSlotProfile(row.slotKind as ImageSlotKind);
    const quality = this.configService.imageStudio.quality;
    const references = await this.loadReferences(row);
    const castNames = (row.references ?? [])
      .filter((reference) => reference.role === 'character' && reference.label)
      .map((reference) => reference.label as string);

    let prompt = row.prompt;
    let attempt = await this.generateOnce(row, prompt, references);
    let cost = estimateImageCostUsd(
      attempt.choice.model,
      quality,
      references.length,
      this.configService.imageStudio.costPerImageUsd,
    );
    let check: ImageCheckResult | null = await this.judge.check({
      image: await this.postprocess.toReference(attempt.image),
      references,
      description: row.description,
      scene: row.sceneSpec,
      castNames,
      usageMetadata: { imageId: row.id },
    });

    if (check && !check.passed) {
      // One silent retry, told what went wrong. The second result is kept
      // whatever its verdict: the author sees it flagged rather than nothing.
      this.logger.info(
        `[IMAGE_STUDIO] image=${row.id} failed its check (${check.issues.join('; ')}), retrying once`,
      );
      prompt = `${row.prompt}\n\nAvoid these problems from a previous attempt: ${check.issues.join(' ')}`;
      try {
        attempt = await this.generateOnce(row, prompt, references);
        cost += estimateImageCostUsd(
          attempt.choice.model,
          quality,
          references.length,
          this.configService.imageStudio.costPerImageUsd,
        );
        check =
          (await this.judge.check({
            image: await this.postprocess.toReference(attempt.image),
            references,
            description: row.description,
            scene: row.sceneSpec,
            castNames,
            usageMetadata: { imageId: row.id, retry: true },
          })) ?? check;
      } catch (error) {
        this.logger.warn(
          `[IMAGE_STUDIO] image=${row.id} retry failed, keeping the first result: ${
            (error as Error)?.message ?? error
          }`,
        );
      }
    }

    const processed = await this.postprocess.process(attempt.image, slot);
    const originalKey = this.assets.originalKey(row.id);
    const displayKey = this.assets.displayKey(row.id);
    await this.assets.put(originalKey, processed.original, 'image/png');
    await this.assets.put(displayKey, processed.display, 'image/webp');

    return {
      patch: {
        provider: attempt.choice.providerType,
        model: attempt.choice.model,
        quality,
        width: processed.width,
        height: processed.height,
        originalKey,
        displayKey,
        imageUrl: this.assets.url(displayKey),
        check: check ?? null,
        costUsd: cost.toFixed(4),
        error: null,
      },
    };
  }
}
