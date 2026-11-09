import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { IMAGE_STUDIO_JUDGE, renderPrompt } from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ImageCheckResult } from '../entity/generated-image.entity';

const JUDGE_MAX_TOKENS = 400;
const JUDGE_TIMEOUT_MS = 30_000;

export interface JudgeInput {
  image: Buffer;
  references: Buffer[];
  description: string;
  scene?: Record<string, unknown> | null;
  castNames: string[];
  usageMetadata?: Record<string, unknown>;
}

const dataUrl = (png: Buffer) =>
  `data:image/png;base64,${png.toString('base64')}`;

/**
 * Looks at a generated image before the author does. Calls a vision model
 * directly because the shared completion service carries text only; the
 * model is config (IMAGE_STUDIO_JUDGE_MODEL), the instructions are the
 * managed prompt `image_studio_judge`.
 *
 * Fails open: when the check cannot run (no key, provider down, bad JSON) the
 * image is shown without a verdict rather than withheld.
 */
@Injectable()
export class ImageJudgeService {
  private readonly logger = LoggerService.getInstance(ImageJudgeService.name);
  private client?: OpenAI;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {}

  isAvailable(): boolean {
    return (
      this.configService.imageStudio.judgeEnabled &&
      !!this.configService.openai.apiKey
    );
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.configService.openai.apiKey,
        timeout: JUDGE_TIMEOUT_MS,
      });
    }
    return this.client;
  }

  async check(input: JudgeInput): Promise<ImageCheckResult | null> {
    if (!this.isAvailable()) return null;
    const model = this.configService.imageStudio.judgeModel;
    try {
      const template =
        (await this.promptSharedService.getPromptByCode(
          IMAGE_STUDIO_JUDGE.code,
        )) ?? '';
      if (!template) throw new Error('image_studio_judge prompt is missing');
      const instructions = renderPrompt(IMAGE_STUDIO_JUDGE, template, {
        description: input.description,
        scene_json: input.scene ? JSON.stringify(input.scene) : '',
        cast_names: input.castNames.join(', '),
      });
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        ...input.references.map(
          (reference) =>
            ({
              type: 'image_url',
              image_url: { url: dataUrl(reference), detail: 'low' },
            }) as const,
        ),
        {
          type: 'text',
          text: input.references.length
            ? `The first ${input.references.length} image(s) are references; the last image is the one to check.`
            : 'Check this image.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUrl(input.image), detail: 'low' },
        },
      ];
      const response = await this.getClient().chat.completions.create({
        model,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: JUDGE_MAX_TOKENS,
      });
      void this.llmUsage.record({
        provider: 'openai',
        model,
        task: LlmTask.IMAGE_STUDIO_JUDGE,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        metadata: { feature: 'image-studio', ...input.usageMetadata },
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      const issues = Array.isArray(parsed.issues)
        ? parsed.issues
            .filter(
              (issue: unknown) => typeof issue === 'string' && issue.trim(),
            )
            .map((issue: string) => issue.trim().slice(0, 200))
            .slice(0, 6)
        : [];
      return { passed: parsed.passed !== false, issues, model };
    } catch (error) {
      this.logger.warn(
        `[IMAGE_STUDIO] check skipped: ${(error as Error)?.message ?? error}`,
      );
      return null;
    }
  }
}
