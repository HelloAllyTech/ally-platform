import { Injectable, Optional } from '@nestjs/common';
import { LimitsService } from '../../billing/service/limits.service';
import { randomUUID } from 'crypto';
import { usageContext } from '../../billing/context/usage-context';
import { UsageChannel, UsageKind } from '../../billing/enum/billing.enum';
import { AiService } from '../../ai/service/ai.service';
import type { CheckupGradeResponse } from '../../ai/dto/checkup.dto';
import {
  ChatbotService,
  type ChatbotTestResult,
} from '../../chatbot/service/chatbot.service';
import { LoggerService } from '../../logger/logger.service';
import { DraftCheckupService } from '../checkup/draft-checkup.service';
import { CheckupService } from '../checkup/checkup.service';
import type { PlannedCase } from '../checkup/checkup-generation';
import type { ChatbotCheckupCase } from '../entity/chatbot-checkup.entity';
import { BotDraftPreviewService } from './bot-draft-preview.service';

export const LIKELY_LIMITS = {
  /** Questions asked at once. */
  concurrency: 4,
  /** The whole batch finishes or gives up after this long. */
  deadlineMs: 90_000,
  defaultCount: 10,
  maxCount: 10,
} as const;

/** What the owner reads when one question got no answer. */
export const LIKELY_NO_ANSWER = "We couldn't get an answer to this one.";

export interface LikelyResult {
  question: string;
  verdict: 'ok' | 'check';
  reason: string | null;
  reply: string;
  handledBy: string;
  citations: number;
}

const REASON_WORDS: Record<string, string> = {
  uncited_answer: "The answer didn't point to a source.",
};

/** A short plain-words reason from the grader's note, or from a reason it is known by. */
export function reasonOf(grade: CheckupGradeResponse): string | null {
  const note = grade.judge?.note?.trim();
  if (note) return note.slice(0, 240);
  for (const code of grade.reasons ?? []) {
    if (REASON_WORDS[code]) return REASON_WORDS[code];
  }
  return null;
}

/**
 * SB1 "Run 10 likely questions": an unsaved look at how the assistant being built answers the
 * questions people are likely to ask. The questions come from the checkup's own writer and each
 * reply is graded by the checkup's own grader, but nothing is kept: no checkup case, no run.
 */
@Injectable()
export class BotDraftLikelyService {
  private readonly logger = LoggerService.getInstance(
    BotDraftLikelyService.name,
  );

  constructor(
    private readonly preview: BotDraftPreviewService,
    private readonly checkupQuestions: DraftCheckupService,
    private readonly chatbots: ChatbotService,
    private readonly ai: AiService,
    // Stage 6: refused at a zero free balance before anything is generated (optional for specs).
    @Optional() private readonly limits?: LimitsService,
  ) {}

  async run(draftId: string, count: number = LIKELY_LIMITS.defaultCount) {
    // Same access, ACTIVE-only rule, one staging and wait for the index as the draft test.
    const { draft, chatbotId } = await this.preview.prepare(draftId);
    // Stage 6: the ten likely questions are paid from the builder's free balance. At $0 they
    // refuse to start (the contact-Ally prompt), before the questions are generated.
    await this.limits?.assertOwnerRun(
      draft.ownerUserId,
      `likely:${draftId}:${randomUUID()}`,
      'checkup',
    );
    const planned = await this.checkupQuestions.likelyQuestions(draft, count);
    if (!planned.length) return { generated: 0, results: [] as LikelyResult[] };

    const prompts = await this.graderPrompts();
    const context = {
      declineText: draft.draftConfig.declineText ?? '',
      about: [draft.draftConfig.introduction, draft.draftConfig.instructions]
        .filter(Boolean)
        .join('\n'),
    };
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), LIKELY_LIMITS.deadlineMs);
    const results: LikelyResult[] = planned.map((p) => ({
      question: p.question,
      verdict: 'check',
      reason: LIKELY_NO_ANSWER,
      reply: '',
      handledBy: '',
      citations: 0,
    }));
    try {
      await usageContext.with(
        {
          chatbotId,
          draftId: draft.id,
          channel: UsageChannel.OWNER,
          runKind: UsageKind.CHECKUP,
        },
        async () => {
          let next = 0;
          const worker = async () => {
            while (next < planned.length && !stop.signal.aborted) {
              const index = next++;
              results[index] = await this.ask(
                chatbotId,
                planned[index],
                prompts,
                context,
                stop.signal,
              );
            }
          };
          await Promise.all(
            Array.from(
              { length: Math.min(LIKELY_LIMITS.concurrency, planned.length) },
              worker,
            ),
          );
        },
      );
    } finally {
      clearTimeout(timer);
      stop.abort();
    }
    return { generated: planned.length, results };
  }

  private async ask(
    chatbotId: string,
    item: PlannedCase,
    prompts: Record<string, unknown> | undefined,
    context: { declineText: string; about: string },
    signal: AbortSignal,
  ): Promise<LikelyResult> {
    const failed: LikelyResult = {
      question: item.question,
      verdict: 'check',
      reason: LIKELY_NO_ANSWER,
      reply: '',
      handledBy: '',
      citations: 0,
    };
    try {
      // An independent single turn: no history, its own thread.
      const tested: ChatbotTestResult = await this.untilStopped(
        this.chatbots.test(
          chatbotId,
          { message: item.question, conversationId: `likely-${randomUUID()}` },
          { onEvent: () => undefined, signal },
        ),
        signal,
      );
      const base = {
        question: item.question,
        reply: tested.reply,
        handledBy: String(tested.handledBy ?? ''),
        citations: tested.citations?.length ?? 0,
      };
      try {
        // The checkup's own grader and its own way of turning a case and a reply into a request.
        const grade = await this.untilStopped(
          this.ai.gradeCheckup(
            CheckupService.gradeRequest(
              { ...item, id: randomUUID() } as unknown as ChatbotCheckupCase,
              tested,
              [],
              prompts,
              context,
            ),
          ),
          signal,
        );
        return {
          ...base,
          verdict: grade.verdict === 'pass' ? 'ok' : 'check',
          reason: grade.verdict === 'pass' ? null : reasonOf(grade),
        };
      } catch {
        // Answered, but not checked: the owner is asked to look at it.
        return { ...base, verdict: 'check', reason: null };
      }
    } catch (error) {
      this.logger.warn(
        `A likely question could not be answered: ${error instanceof Error ? error.name : 'error'}`,
      );
      return failed;
    }
  }

  /** Gives up waiting when the batch's time is up (the work behind it is told to stop too). */
  private untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      work.catch(() => undefined);
      return Promise.reject(new Error('stopped'));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error('stopped'));
      signal.addEventListener('abort', onAbort, { once: true });
      work
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private async graderPrompts(): Promise<Record<string, unknown> | undefined> {
    try {
      return (await this.ai.getPromptOverrides([
        'ally_ai_checkup_judge',
      ])) as Record<string, unknown>;
    } catch {
      return undefined; // ally-ai falls back to its default prompt text
    }
  }
}
