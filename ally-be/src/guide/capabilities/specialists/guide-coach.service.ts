import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { GUIDE_AI_TASKS } from '../../constants/guide-ai-tasks.constants';
import {
  COACH_AFTER_ACTION_SCHEMA,
  COACH_NOTE_SCHEMA,
  COACH_PREBRIEF_SCHEMA,
  COACH_PROMPT_SCHEMA,
  COACH_SYSTEM_PROMPT,
  CoachHistoryAttempt,
  CoachKind,
  buildCoachAfterActionMessage,
  buildCoachNoteMessage,
  buildCoachPrebriefMessage,
  buildCoachPromptMessage,
} from '../../prompts/coach.prompt';
import {
  GuideBudgetTier,
  GuideReleaseBundle,
} from '../../release/guide-release.bundle';
import {
  GuideCallAttribution,
  GuideModelService,
} from '../../runtime/guide-model.service';

export interface CoachActivity {
  kind: CoachKind;
  title: string;
  prompt: string;
  placeholder: string;
  focus: { itemId: string; title: string; text: string } | null;
}

export interface CoachPrebrief {
  focus: string;
  brief: string;
  rehearsal: string;
}

export interface CoachAfterAction {
  whatHappened: string;
  why: string;
  tryNext: string;
}

interface CoachActivityRef {
  title: string;
  type: string;
  description: string;
}

/**
 * A line that reports a score or a mark: "72%", "8/10", "scored 60",
 * "a grade of B". The Coach is told never to; this is the check that it
 * didn't (plan §7.7, "never scores").
 */
export function mentionsScore(text: string): boolean {
  return (
    /\b\d{1,3}\s*(%|percent\b|\/\s*\d{1,3}\b|points?\b|marks?\b)/i.test(text) ||
    /\b(scored?|scoring|grade[ds]?|rated)\b[^.]{0,20}\d/i.test(text)
  );
}

/** Trimmed and clipped; empty when it reports a score. */
const coachLine = (value: unknown, max: number): string => {
  const text = String(value ?? '').trim();
  if (!text || mentionsScore(text)) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

interface CoachCall {
  bundle: GuideReleaseBundle;
  tier?: GuideBudgetTier;
  attribution: GuideCallAttribution;
  onCost?: (usd: number) => void;
}

/**
 * The Coach specialist (plans/ally-guide/plan.md §4.4, §4.6, §7.7): the
 * open-ended side quests and the one specific note on what the learner
 * writes. Never scores; never about a client's outcome.
 */
@Injectable()
export class GuideCoachService {
  private readonly logger = LoggerService.getInstance(GuideCoachService.name);

  constructor(private readonly models: GuideModelService) {}

  async prompt(
    input: CoachCall & {
      kind: CoachKind;
      languageCode: string;
      focus: {
        itemId: string;
        title: string;
        type: string;
        text: string;
      } | null;
    },
  ): Promise<CoachActivity | null> {
    const parsed = await this.call<{
      title?: string;
      prompt?: string;
      placeholder?: string;
    }>(input, buildCoachPromptMessage(input), COACH_PROMPT_SCHEMA, 2_000);
    const prompt = String(parsed?.prompt ?? '').trim();
    if (!prompt) return null;
    return {
      kind: input.kind,
      title:
        String(parsed?.title ?? '')
          .trim()
          .slice(0, 60) || 'Practice',
      prompt: prompt.slice(0, 400),
      placeholder: String(parsed?.placeholder ?? '')
        .trim()
        .slice(0, 80),
      focus: input.focus
        ? {
            itemId: input.focus.itemId,
            title: input.focus.title,
            text: input.focus.text.slice(0, 2_000),
          }
        : null,
    };
  }

  async note(
    input: CoachCall & {
      activity: CoachActivity;
      answer: string;
      languageCode: string;
    },
  ): Promise<string | null> {
    const parsed = await this.call<{ note?: string }>(
      input,
      buildCoachNoteMessage({
        kind: input.activity.kind,
        languageCode: input.languageCode,
        prompt: input.activity.prompt,
        answer: input.answer,
        focus: input.activity.focus,
      }),
      COACH_NOTE_SCHEMA,
      3_000,
    );
    const note = String(parsed?.note ?? '').trim();
    return note ? note.slice(0, 600) : null;
  }

  /**
   * A pre-brief before a roleplay or case (plan §4.4): one focus from the
   * learner's own practice history, a short brief, and a rehearsal offer.
   * Null when the model gave nothing usable.
   */
  async prebrief(
    input: CoachCall & {
      languageCode: string;
      activity: CoachActivityRef;
      history: CoachHistoryAttempt[];
      learnerGoals: string[];
    },
  ): Promise<CoachPrebrief | null> {
    const parsed = await this.call<Record<string, unknown>>(
      input,
      buildCoachPrebriefMessage(input),
      COACH_PREBRIEF_SCHEMA,
      2_000,
    );
    const focus = coachLine(parsed?.focus, 200);
    const brief = coachLine(parsed?.brief, 500);
    if (!focus && !brief) return null;
    return {
      focus,
      brief,
      rehearsal: coachLine(parsed?.rehearsal, 160),
    };
  }

  /**
   * An after-action review (plan §4.4): what happened, why, what to try
   * next. Consequences, never a score; a line that reports one is dropped.
   */
  async afterAction(
    input: CoachCall & {
      languageCode: string;
      activity: CoachActivityRef;
      attempt: CoachHistoryAttempt | null;
      history: CoachHistoryAttempt[];
      learnerNoticed: string | null;
    },
  ): Promise<CoachAfterAction | null> {
    const parsed = await this.call<Record<string, unknown>>(
      input,
      buildCoachAfterActionMessage(input),
      COACH_AFTER_ACTION_SCHEMA,
      2_500,
    );
    const review = {
      whatHappened: coachLine(parsed?.what_happened, 400),
      why: coachLine(parsed?.why, 400),
      tryNext: coachLine(parsed?.try_next, 300),
    };
    return review.whatHappened || review.tryNext ? review : null;
  }

  private async call<T>(
    input: CoachCall,
    content: string,
    schema: unknown,
    maxTokens: number,
  ): Promise<T | null> {
    const { result } = await this.models.complete({
      role: 'coach',
      bundle: input.bundle,
      tier: input.tier,
      task: LlmTask.GUIDE_COACH,
      aiTaskId: GUIDE_AI_TASKS.COACH,
      attribution: input.attribution,
      onCost: input.onCost,
      request: {
        system: [
          {
            text: input.bundle.prompts.coach?.text ?? COACH_SYSTEM_PROMPT,
            cache: true,
          },
        ],
        messages: [{ role: 'user', content }],
        maxTokens,
        outputSchema: schema as Record<string, unknown>,
        timeoutMs: 30_000,
      },
    });
    if (result.stopReason !== 'end_turn') {
      this.logger.warn(`Coach stopped with ${result.stopReason}`);
      return null;
    }
    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
    return JSON.parse(text) as T;
  }
}
