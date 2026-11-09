import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { TokenUser } from 'src/auth/type/auth.types';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioCharacter } from 'src/scenario-character/entity/scenario-character.entity';
import { Track } from 'src/track/entity/track.entity';
import {
  getSlotProfile,
  IMAGE_SLOT_PROFILES,
  ImageSlotKind,
  ImageSlotProfile,
} from '../constants/image-slots.constants';
import {
  findImageStyle,
  IMAGE_STYLES,
  ImageStyleDefinition,
  styleThumbnailKey,
} from '../constants/image-styles.constants';
import {
  estimateImageCostUsd,
  IMAGE_STUDIO_HISTORY_LIMIT,
  IMAGE_STUDIO_MAX_BATCH,
  IMAGE_STUDIO_MAX_VARIANTS,
} from '../constants/image-studio.constants';
import {
  CastSheetDto,
  DescribeImageRequestDto,
  DescribeImageResponseDto,
  EstimateImagesRequestDto,
  EstimateImagesResponseDto,
  GeneratedImageDto,
  GenerateImageRequestDto,
  GenerateImagesResponseDto,
  ImageReferenceInputDto,
  ImageSlotProfileDto,
  ImageStudioConfigDto,
  ImageStyleDto,
} from '../dto/image-studio.dto';
import {
  GeneratedImage,
  GeneratedImageStatus,
  StoredImageReference,
} from '../entity/generated-image.entity';
import { GeneratedImageRepository } from '../repository/generated-image.repository';
import { CastMember, compileImagePrompt } from '../util/image-prompt.compiler';
import { ImageAssetService } from './image-asset.service';
import { ImageComposeService } from './image-compose.service';
import { ImageStudioWorkerService } from './image-studio-worker.service';

/** Reference priority when there are more than the cap: identity first. */
const ROLE_PRIORITY: Record<StoredImageReference['role'], number> = {
  refine: 0,
  character: 1,
  setting: 2,
  previous: 3,
  style: 4,
};

const PARALLEL_COMPOSE = 4;

const toIso = (value?: Date | null) =>
  value ? new Date(value).toISOString() : undefined;

export const toGeneratedImageDto = (
  row: GeneratedImage,
): GeneratedImageDto => ({
  id: row.id,
  batchId: row.batchId,
  slotKind: row.slotKind,
  styleId: row.styleId,
  description: row.description,
  altText: row.altText ?? '',
  status:
    row.status === GeneratedImageStatus.EXPIRED
      ? GeneratedImageStatus.FAILED
      : (row.status as GeneratedImageDto['status']),
  ...(row.imageUrl && row.status === GeneratedImageStatus.SUCCEEDED
    ? { imageUrl: row.imageUrl }
    : {}),
  ...(row.width ? { width: row.width } : {}),
  ...(row.height ? { height: row.height } : {}),
  ...(row.error ? { error: row.error } : {}),
  ...(row.status === GeneratedImageStatus.EXPIRED
    ? { error: 'This image was removed because it was never used.' }
    : {}),
  ...(row.check
    ? { check: { passed: row.check.passed, issues: row.check.issues } }
    : {}),
  referenceIds: (row.references ?? [])
    .map((reference) => reference.imageId)
    .filter((id): id is string => !!id),
  ...(row.refinedFromId ? { refinedFromId: row.refinedFromId } : {}),
  ...(row.characterId ? { characterId: row.characterId } : {}),
  ...(row.costUsd != null ? { costUsd: Number(row.costUsd) } : {}),
  createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
  ...(row.finishedAt ? { finishedAt: toIso(row.finishedAt) } : {}),
  ...(row.acceptedAt ? { acceptedAt: toIso(row.acceptedAt) } : {}),
});

interface PreparedRequest {
  slot: ImageSlotProfile;
  style: ImageStyleDefinition;
  cast: CastMember[];
  references: StoredImageReference[];
  variants: number;
}

@Injectable()
export class ImageStudioService {
  constructor(
    private readonly configService: AppConfigService,
    private readonly repository: GeneratedImageRepository,
    private readonly compose: ImageComposeService,
    private readonly assets: ImageAssetService,
    private readonly worker: ImageStudioWorkerService,
    @InjectRepository(ScenarioCharacter)
    private readonly characters: Repository<ScenarioCharacter>,
    @InjectRepository(Track)
    private readonly tracks: Repository<Track>,
  ) {}

  /**
   * On, and able to draw: a switched-on studio with no image-provider key
   * would offer Generate and then fail every image after a long wait.
   */
  private isAvailable(): boolean {
    return (
      this.configService.imageStudio.enabled &&
      !!(this.configService.openai?.apiKey || this.configService.gemini?.apiKey)
    );
  }

  getConfig(): ImageStudioConfigDto {
    const config = this.configService.imageStudio;
    return {
      enabled: this.isAvailable(),
      maxVariants: IMAGE_STUDIO_MAX_VARIANTS,
      maxReferences: config.maxReferences,
      maxBatch: IMAGE_STUDIO_MAX_BATCH,
    };
  }

  getStyles(): ImageStyleDto[] {
    return IMAGE_STYLES.map((style) => ({
      id: style.id,
      name: style.name,
      description: style.description,
      kind: style.kind,
      thumbnailUrl: this.safeUrl(styleThumbnailKey(style.id)),
      swatch: style.swatch,
      recommendedSlots: style.recommendedSlots,
    }));
  }

  getSlots(): ImageSlotProfileDto[] {
    return Object.values(IMAGE_SLOT_PROFILES).map((slot) => ({
      kind: slot.kind,
      label: slot.label,
      width: slot.width,
      height: slot.height,
      aspectRatio: slot.aspectRatio,
      allowsReferences: slot.allowsReferences,
      defaultStyleId: slot.defaultStyleId,
      defaultVariants: slot.defaultVariants,
    }));
  }

  private safeUrl(key: string): string {
    try {
      return this.assets.url(key);
    } catch {
      return '';
    }
  }

  private assertEnabled(): void {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException(
        'AI image generation is turned off.',
      );
    }
  }

  private styleFor(
    styleId: string | undefined,
    slot: ImageSlotProfile,
  ): ImageStyleDefinition {
    const style = findImageStyle(styleId ?? slot.defaultStyleId);
    if (!style)
      throw new BadRequestException(`Unknown image style "${styleId}"`);
    return style;
  }

  private async loadCast(ids: string[] | undefined): Promise<CastMember[]> {
    if (!ids?.length) return [];
    const rows = await this.characters.find({ where: { id: In(ids) } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is ScenarioCharacter => !!row)
      .map((row) => ({
        id: row.id,
        name: row.name,
        appearance:
          row.appearance ||
          [
            row.age ? `${row.age} years old` : '',
            row.gender ?? '',
            row.profession ?? '',
          ]
            .filter(Boolean)
            .join(', '),
      }));
  }

  /** Validate and resolve the author's references to stored ones, capped and ordered. */
  private async resolveReferences(
    user: TokenUser,
    dto: GenerateImageRequestDto,
    cast: CastMember[],
    style: ImageStyleDefinition,
  ): Promise<StoredImageReference[]> {
    const tenantId = user.tenantId ?? null;
    const resolved: StoredImageReference[] = [];
    const inputs: (
      | ImageReferenceInputDto
      | { role: 'refine'; imageId: string; label?: string }
    )[] = [
      ...(dto.refine
        ? [{ role: 'refine' as const, imageId: dto.refine.imageId }]
        : []),
      ...(dto.references ?? []),
    ];

    const ids = inputs
      .map((input) => input.imageId)
      .filter((id): id is string => !!id);
    const owned = new Map(
      (await this.repository.findForTenant(ids, tenantId)).map((row) => [
        row.id,
        row,
      ]),
    );

    for (const input of inputs) {
      if (input.imageId) {
        const source = owned.get(input.imageId);
        if (
          !source ||
          source.status !== GeneratedImageStatus.SUCCEEDED ||
          !source.originalKey
        ) {
          throw new BadRequestException(
            'A reference image is missing or not finished yet.',
          );
        }
        resolved.push({
          role: input.role,
          label: input.label,
          imageId: source.id,
        });
      } else if ('url' in input && input.url) {
        const location = this.assets.locate(input.url);
        resolved.push({
          role: input.role,
          label: input.label,
          s3Bucket: location.bucket,
          s3Key: location.key,
        });
      } else {
        throw new BadRequestException('A reference needs an imageId or a url.');
      }
    }

    // Each cast member's accepted cast sheet in this style keeps their face.
    if (cast.length && dto.slotKind !== ImageSlotKind.CAST_SHEET) {
      const sheets = await this.repository.findCastSheets(
        tenantId,
        cast.map((member) => member.id),
        style.id,
      );
      for (const sheet of sheets) {
        if (resolved.some((reference) => reference.imageId === sheet.id))
          continue;
        const member = cast.find((entry) => entry.id === sheet.characterId);
        resolved.push({
          role: 'character',
          label: member?.name,
          imageId: sheet.id,
        });
      }
    }

    // Deduplicate, order by priority, cap.
    const seen = new Set<string>();
    return resolved
      .filter((reference) => {
        const key =
          reference.imageId ?? `${reference.s3Bucket}/${reference.s3Key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role])
      .slice(0, this.configService.imageStudio.maxReferences);
  }

  private async prepare(
    user: TokenUser,
    dto: GenerateImageRequestDto,
    variantsOverride?: number,
  ): Promise<PreparedRequest> {
    const slot = getSlotProfile(dto.slotKind);
    const style = this.styleFor(dto.styleId, slot);
    const cast = await this.loadCast(dto.castCharacterIds);
    const references = await this.resolveReferences(user, dto, cast, style);
    const variants = Math.min(
      IMAGE_STUDIO_MAX_VARIANTS,
      Math.max(1, variantsOverride ?? dto.variants ?? slot.defaultVariants),
    );
    return { slot, style, cast, references, variants };
  }

  async describe(
    user: TokenUser,
    dto: DescribeImageRequestDto,
  ): Promise<DescribeImageResponseDto> {
    this.assertEnabled();
    const slot = getSlotProfile(dto.slotKind);
    const style = this.styleFor(dto.styleId, slot);
    const cast = await this.loadCast(dto.castCharacterIds);
    const result = await this.compose.compose({
      slot,
      style,
      context: dto.context,
      cast,
      usageMetadata: { mode: 'describe', slotKind: slot.kind, userId: user.id },
    });
    return {
      description: result.description,
      altText: result.altText,
      safety: result.safety,
    };
  }

  private async assertCapacity(user: TokenUser, adding: number): Promise<void> {
    const active = await this.repository.countActiveFor(user.id);
    if (active + adding > this.configService.imageStudio.maxActivePerUser) {
      throw new HttpException(
        'You have several images generating already. Wait for some to finish.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Compose and build the rows for one request; blocked requests become one failed row when `failBlocked`. */
  private async buildRows(
    user: TokenUser,
    dto: GenerateImageRequestDto,
    batchId: string,
    options: { variants?: number; failBlocked: boolean },
  ): Promise<GeneratedImage[]> {
    const prepared = await this.prepare(user, dto, options.variants);
    const composed = await this.compose.compose({
      slot: prepared.slot,
      style: prepared.style,
      description: dto.description,
      context: dto.context,
      cast: prepared.cast,
      usageMetadata: {
        mode: 'generate',
        slotKind: prepared.slot.kind,
        userId: user.id,
      },
    });

    const base = {
      tenantId: user.tenantId ?? null,
      createdBy: user.id,
      batchId,
      slotKind: prepared.slot.kind,
      slotKey: dto.slotKey ?? null,
      styleId: prepared.style.id,
      // The author's words are what history shows; the composed version only feeds the prompt.
      description: dto.description,
      sceneSpec: (composed.scene as Record<string, unknown>) ?? null,
      altText: composed.altText,
      references: prepared.references,
      castCharacterIds: prepared.cast.map((member) => member.id),
      characterId:
        prepared.slot.kind === ImageSlotKind.CAST_SHEET
          ? (prepared.cast[0]?.id ?? dto.context?.characterId ?? null)
          : null,
      refinedFromId: dto.refine?.imageId ?? null,
      context: dto.context
        ? {
            trackId: dto.context.trackId,
            itemId: dto.context.itemId,
            nodeId: dto.context.nodeId,
            scenarioId: dto.context.scenarioId,
            characterId: dto.context.characterId,
          }
        : null,
    };

    if (!composed.safety.ok) {
      if (!options.failBlocked) {
        throw new UnprocessableEntityException({
          message:
            composed.safety.reason ??
            "This can't be made into an image as written.",
          safety: composed.safety,
        });
      }
      return [
        this.repository.create({
          ...base,
          prompt: '',
          status: GeneratedImageStatus.FAILED,
          error: [composed.safety.reason, composed.safety.suggestion]
            .filter(Boolean)
            .join(' '),
          finishedAt: new Date(),
        }),
      ];
    }

    const prompt = compileImagePrompt({
      slot: prepared.slot,
      style: prepared.style,
      // The composer's tidy description is concrete; fall back to the author's.
      description: composed.description || dto.description,
      scene: composed.scene,
      cast: prepared.cast,
      references: prepared.references,
      refineInstruction: dto.refine?.instruction,
    });

    return Array.from({ length: prepared.variants }, () =>
      this.repository.create({
        ...base,
        prompt,
        status: GeneratedImageStatus.QUEUED,
      }),
    );
  }

  async generate(
    user: TokenUser,
    dto: GenerateImageRequestDto,
  ): Promise<GenerateImagesResponseDto> {
    this.assertEnabled();
    await this.assertCapacity(
      user,
      dto.variants ?? getSlotProfile(dto.slotKind).defaultVariants,
    );
    const batchId = randomUUID();
    const rows = await this.buildRows(user, dto, batchId, {
      failBlocked: false,
    });
    const saved = await this.repository.save(rows);
    this.worker.kick();
    return { batchId, images: saved.map(toGeneratedImageDto) };
  }

  async generateBatch(
    user: TokenUser,
    items: GenerateImageRequestDto[],
  ): Promise<GenerateImagesResponseDto> {
    this.assertEnabled();
    if (!items.length) throw new BadRequestException('Nothing to generate.');
    if (items.length > IMAGE_STUDIO_MAX_BATCH) {
      throw new BadRequestException(
        `At most ${IMAGE_STUDIO_MAX_BATCH} images per batch.`,
      );
    }
    await this.assertCapacity(user, items.length);
    const batchId = randomUUID();
    const rows: GeneratedImage[] = [];
    for (let start = 0; start < items.length; start += PARALLEL_COMPOSE) {
      const chunk = items.slice(start, start + PARALLEL_COMPOSE);
      const built = await Promise.all(
        chunk.map((item) =>
          this.buildRows(user, item, batchId, {
            variants: 1,
            failBlocked: true,
          }),
        ),
      );
      rows.push(...built.flat());
    }
    const saved = await this.repository.save(rows);
    this.worker.kick();
    return { batchId, images: saved.map(toGeneratedImageDto) };
  }

  estimate(dto: EstimateImagesRequestDto): EstimateImagesResponseDto {
    const config = this.configService.imageStudio;
    const items = dto.items?.length
      ? dto.items.map((item) => ({
          references:
            (item.references?.length ?? 0) +
            (item.castCharacterIds?.length ?? 0),
          count:
            dto.items!.length > 1
              ? 1
              : (item.variants ??
                getSlotProfile(item.slotKind).defaultVariants),
        }))
      : [{ references: dto.references ?? 0, count: dto.count ?? 1 }];
    let total = 0;
    let images = 0;
    for (const item of items) {
      const references = Math.min(item.references, config.maxReferences);
      const providerDefault = (provider: string) =>
        provider === 'gemini'
          ? this.configService.gemini.imageModel
          : this.configService.openai.imageModel;
      const model =
        references > 0
          ? (config.referenceModel ?? providerDefault(config.referenceProvider))
          : (config.textModel ?? providerDefault(config.textProvider));
      total +=
        estimateImageCostUsd(
          model,
          config.quality,
          references,
          config.costPerImageUsd,
        ) * item.count;
      images += item.count;
    }
    const totalUsd = Math.round(total * 100) / 100;
    return {
      images,
      perImageUsd: images ? Math.round((total / images) * 1000) / 1000 : 0,
      totalUsd,
    };
  }

  async getJobs(user: TokenUser, ids: string[]): Promise<GeneratedImageDto[]> {
    const unique = [...new Set(ids)].slice(0, 80);
    const rows = await this.repository.findForTenant(
      unique,
      user.tenantId ?? null,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return unique
      .map((id) => byId.get(id))
      .filter((row): row is GeneratedImage => !!row)
      .map(toGeneratedImageDto);
  }

  async history(
    user: TokenUser,
    slotKey: string,
    limit?: number,
  ): Promise<GeneratedImageDto[]> {
    const rows = await this.repository.findHistory(
      user.tenantId ?? null,
      slotKey,
      Math.min(limit ?? IMAGE_STUDIO_HISTORY_LIMIT, 48),
    );
    return rows.map(toGeneratedImageDto);
  }

  async accept(
    user: TokenUser,
    id: string,
    trackId?: string,
  ): Promise<GeneratedImageDto> {
    const [row] = await this.repository.findForTenant(
      [id],
      user.tenantId ?? null,
    );
    if (!row || row.status !== GeneratedImageStatus.SUCCEEDED) {
      throw new NotFoundException('That image is not available.');
    }
    if (!row.acceptedAt) {
      row.acceptedAt = new Date();
      await this.repository.update(row.id, { acceptedAt: row.acceptedAt });
    }
    // The first image accepted into a course becomes its style example when
    // the course has none and the image is in the course's style (or the
    // course has not chosen one yet). Covers and icons are excluded: a badge
    // is a poor example of how scenes should look.
    const examples: string[] = [
      ImageSlotKind.SCENE,
      ImageSlotKind.ARTICLE_COVER,
      ImageSlotKind.ARTICLE_INLINE,
      ImageSlotKind.QUIZ_QUESTION,
      ImageSlotKind.COURSE_COVER,
    ];
    if (trackId && examples.includes(row.slotKind)) {
      const track = await this.tracks.findOne({
        where: { id: trackId },
        select: ['id', 'imageStyleId', 'imageStyleAnchorId'],
      });
      if (
        track &&
        !track.imageStyleAnchorId &&
        (!track.imageStyleId || track.imageStyleId === row.styleId)
      ) {
        await this.tracks.update(track.id, {
          imageStyleAnchorId: row.id,
          imageStyleId: track.imageStyleId ?? row.styleId,
        });
      }
    }
    return toGeneratedImageDto(row);
  }

  async castSheets(
    user: TokenUser,
    characterIds: string[],
    styleId: string,
  ): Promise<CastSheetDto[]> {
    const rows = await this.repository.findCastSheets(
      user.tenantId ?? null,
      characterIds.slice(0, 20),
      styleId,
    );
    return rows.map((row) => ({
      characterId: row.characterId as string,
      styleId: row.styleId,
      image: toGeneratedImageDto(row),
    }));
  }
}
