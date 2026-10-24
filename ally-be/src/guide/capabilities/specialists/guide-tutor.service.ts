import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { CourseSpine } from '../../conductor/course-spine';
import { GUIDE_AI_TASKS } from '../../constants/guide-ai-tasks.constants';
import {
  GuideCourseContentService,
  TutorSource,
} from '../../content/guide-course-content.service';
import {
  TUTOR_OUTPUT_SCHEMA,
  TUTOR_SYSTEM_PROMPT,
  buildTutorUserMessage,
} from '../../prompts/tutor.prompt';
import {
  GuideBudgetTier,
  GuideReleaseBundle,
} from '../../release/guide-release.bundle';
import {
  GuideCallAttribution,
  GuideModelService,
} from '../../runtime/guide-model.service';

export interface TutorAnswer {
  covered: boolean;
  answer: string;
  citations: Array<{ itemId: string; title: string; quote: string }>;
}

const TUTOR_MAX_TOKENS = 4_000;
const TUTOR_TIMEOUT_MS = 30_000;

/**
 * Grounded answers with citations (plans/ally-guide/plan.md §7.7). A
 * one-shot structured call per question; a citation is kept only when its
 * quote really occurs in the passage it names, so Ally can never cite the
 * course for something it does not say.
 */
@Injectable()
export class GuideTutorService {
  private readonly logger = LoggerService.getInstance(GuideTutorService.name);

  constructor(
    private readonly content: GuideCourseContentService,
    private readonly models: GuideModelService,
  ) {}

  async consult(input: {
    question: string;
    trackId: string;
    spine: CourseSpine;
    languageCode: string;
    bundle: GuideReleaseBundle;
    tier?: GuideBudgetTier;
    attribution: GuideCallAttribution;
    onCost?: (usd: number) => void;
  }): Promise<TutorAnswer> {
    const sources = await this.content.tutorSources(
      input.trackId,
      input.spine,
      input.languageCode,
    );
    if (!sources.length) return { covered: false, answer: '', citations: [] };
    const { result } = await this.models.complete({
      role: 'tutor',
      bundle: input.bundle,
      tier: input.tier,
      task: LlmTask.GUIDE_TUTOR,
      aiTaskId: GUIDE_AI_TASKS.TUTOR,
      attribution: input.attribution,
      onCost: input.onCost,
      request: {
        system: [
          {
            text: input.bundle.prompts.tutor?.text ?? TUTOR_SYSTEM_PROMPT,
            cache: true,
          },
        ],
        messages: [
          {
            role: 'user',
            content: buildTutorUserMessage(input.question, sources),
          },
        ],
        maxTokens: TUTOR_MAX_TOKENS,
        outputSchema: TUTOR_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        timeoutMs: TUTOR_TIMEOUT_MS,
      },
    });
    if (result.stopReason !== 'end_turn') {
      this.logger.warn(`Tutor stopped with ${result.stopReason}`);
      return { covered: false, answer: '', citations: [] };
    }
    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
    return verifyTutorAnswer(JSON.parse(text), sources);
  }
}

const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”"‘’']/g, '')
    .trim();

/** Keep only citations whose quote is really in the passage they name. */
export function verifyTutorAnswer(
  raw: unknown,
  sources: TutorSource[],
): TutorAnswer {
  const value = (raw ?? {}) as Record<string, any>;
  const byId = new Map(sources.map((source) => [source.itemId, source]));
  const citations = (Array.isArray(value.citations) ? value.citations : [])
    .map((citation: any) => {
      const source = byId.get(String(citation?.itemId ?? ''));
      const quote = String(citation?.quote ?? '').trim();
      if (!source || !quote || !squash(source.text).includes(squash(quote))) {
        return null;
      }
      return { itemId: source.itemId, title: source.title, quote };
    })
    .filter(Boolean) as TutorAnswer['citations'];
  const answer = typeof value.answer === 'string' ? value.answer.trim() : '';
  // An answer with no citation that survived is not grounded.
  const covered =
    Boolean(value.covered) && Boolean(answer) && citations.length > 0;
  return {
    covered,
    answer: covered ? answer : '',
    citations: covered ? citations : [],
  };
}
