import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import { IMAGE_STUDIO_COMPOSE, renderPrompt } from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  keywordScreen,
  SAFETY_SUGGESTION_DEPICTION,
} from '../constants/image-safety.constants';
import { ImageSlotProfile } from '../constants/image-slots.constants';
import { ImageStyleDefinition } from '../constants/image-styles.constants';
import { ImageContextDto, ImageSafetyDto } from '../dto/image-studio.dto';
import { CastMember, ImageSceneSpec } from '../util/image-prompt.compiler';

const AI_TASK_ID = 'image-studio-compose';
const COMPOSE_MAX_TOKENS = 1_200;
const COMPOSE_TIMEOUT_MS = 20_000;
const CONTEXT_MAX_CHARS = 3_000;
const ALT_TEXT_MAX = 300;

export interface ComposeInput {
  slot: ImageSlotProfile;
  style: ImageStyleDefinition;
  description?: string;
  context?: ImageContextDto;
  cast?: CastMember[];
  usageMetadata?: Record<string, unknown>;
}

export interface ComposeResult {
  safety: ImageSafetyDto;
  description: string;
  altText: string;
  scene: ImageSceneSpec | null;
  /** False when the model call failed and the result is the local fallback. */
  composed: boolean;
}

const strip = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

/** The course content as compact JSON, empty fields dropped. */
export const contextToJson = (context?: ImageContextDto): string => {
  if (!context) return '';
  const compact: Record<string, unknown> = {};
  const put = (key: string, value: unknown, max: number) => {
    const text = strip(value, max);
    if (text) compact[key] = text;
  };
  put('course', context.courseTitle, 200);
  put('title', context.title, 300);
  put('text', context.text, CONTEXT_MAX_CHARS);
  put('audience', context.audience, 200);
  if (context.persona) {
    const persona: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context.persona)) {
      const text = strip(
        value === null || value === undefined ? '' : String(value),
        300,
      );
      if (text) persona[key] = text;
    }
    if (Object.keys(persona).length) compact.persona = persona;
  }
  return Object.keys(compact).length ? JSON.stringify(compact) : '';
};

/** A description to fall back on when the model is unavailable. */
const fallbackDescription = (input: ComposeInput): string => {
  const own = strip(input.description, 2000);
  if (own) return own;
  const persona = input.context?.persona;
  if (persona?.name || persona?.profession) {
    return strip(
      `${persona.name ?? 'A person'}${persona.age ? `, ${persona.age} years old` : ''}${
        persona.profession ? `, ${persona.profession}` : ''
      }${persona.currentLocation ? `, in ${persona.currentLocation}` : ''}. ${persona.appearance ?? ''}`,
      2000,
    );
  }
  return strip(
    [input.context?.title, input.context?.text].filter(Boolean).join('. '),
    600,
  );
};

/**
 * Plans an image before any pixels are paid for: one fast JSON call that
 * screens the request, drafts or tidies the description, writes alt text and
 * a structured scene. The keyword screen runs on both the request and the
 * model's description regardless, so a model that waves something through, or
 * is down, does not let a method-of-harm image reach the provider.
 */
@Injectable()
export class ImageComposeService {
  private readonly logger = LoggerService.getInstance(ImageComposeService.name);

  constructor(
    private readonly llmCompletion: LlmCompletionService,
    private readonly promptSharedService: PromptSharedService,
  ) {}

  async compose(input: ComposeInput): Promise<ComposeResult> {
    const ownDescription = strip(input.description, 2000);
    const requestScreen = keywordScreen(
      [ownDescription, input.context?.title, input.context?.text]
        .filter(Boolean)
        .join(' '),
    );
    // The course text may legitimately discuss a method (it is training
    // material); only the author's own request blocks on the keyword screen.
    const ownScreen = ownDescription
      ? keywordScreen(ownDescription)
      : { ok: true };
    if (!ownScreen.ok) {
      return {
        safety: ownScreen,
        description: ownDescription,
        altText: '',
        scene: null,
        composed: false,
      };
    }

    try {
      const template =
        (await this.promptSharedService.getPromptByCode(
          IMAGE_STUDIO_COMPOSE.code,
        )) ?? '';
      if (!template) throw new Error('image_studio_compose prompt is missing');
      const system = renderPrompt(IMAGE_STUDIO_COMPOSE, template, {
        image_purpose: input.slot.purpose,
        style_name: `${input.style.name} — ${input.style.description}`,
        framing: input.slot.framing,
        description: ownDescription,
        context_json: contextToJson(input.context),
        cast_json: input.cast?.length
          ? JSON.stringify(
              input.cast.map((member) => ({
                name: member.name,
                look: member.appearance ?? '',
              })),
            )
          : '',
      });
      const response = await this.llmCompletion.complete({
        taskId: AI_TASK_ID,
        task: LlmTask.IMAGE_STUDIO_COMPOSE,
        promptCode: IMAGE_STUDIO_COMPOSE.code,
        system,
        prompt: 'Plan the image now. Answer with the JSON object only.',
        maxTokens: COMPOSE_MAX_TOKENS,
        timeoutMs: COMPOSE_TIMEOUT_MS,
        jsonMode: true,
        usageMetadata: { feature: 'image-studio', ...input.usageMetadata },
      });
      const parsed = JSON.parse(response.text || '{}') as Record<string, any>;
      const description =
        strip(parsed.description, 2000) || fallbackDescription(input);
      const descriptionScreen = keywordScreen(description);
      const safe = parsed.safe !== false && descriptionScreen.ok;
      return {
        safety: safe
          ? { ok: true }
          : {
              ok: false,
              reason:
                strip(parsed.reason, 400) ||
                descriptionScreen.reason ||
                "This can't be made into an image as written.",
              suggestion:
                strip(parsed.suggestion, 400) ||
                descriptionScreen.suggestion ||
                SAFETY_SUGGESTION_DEPICTION,
            },
        description,
        altText:
          strip(parsed.alt_text, ALT_TEXT_MAX) || strip(description, 160),
        scene:
          parsed.scene && typeof parsed.scene === 'object'
            ? parsed.scene
            : null,
        composed: true,
      };
    } catch (error) {
      this.logger.warn(
        `[IMAGE_STUDIO] compose fell back to the raw description: ${
          (error as Error)?.message ?? error
        }`,
      );
      const description = fallbackDescription(input);
      const screen = ownDescription
        ? requestScreen
        : keywordScreen(description);
      return {
        safety: ownDescription
          ? { ok: true }
          : screen.ok
            ? { ok: true }
            : screen,
        description,
        altText: strip(description, 160),
        scene: null,
        composed: false,
      };
    }
  }
}
