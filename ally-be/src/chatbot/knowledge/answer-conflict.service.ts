import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { LlmCompletionService } from '../../llm-agent/service/llm-completion.service';
import { WaUnansweredReason } from '../../whatsapp/enum/whatsapp.enum';

export interface ConflictPassage {
  documentId: string;
  text: string;
  title?: string | null;
}

export type ConflictReason = 'phone' | 'email' | 'amount' | 'judge';

export interface ConflictResult {
  conflict: boolean;
  /** The two passages that disagree (from different documents), when `conflict`. */
  passages: ConflictPassage[];
  reason: ConflictReason | null;
}

/** The AI task registry row of the optional judge. */
export const CONFLICT_JUDGE_TASK_ID = 'knowledge-conflict-judge';

const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Money: a currency mark next to a number. */
const AMOUNT =
  /(?:₹|rs\.?|inr|\$|usd|€|£)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:rupees|rs|inr|dollars)/gi;

function valuesOf(text: string) {
  const phones = new Set(
    (text.match(PHONE) ?? [])
      .map((p) => p.replace(/\D/g, ''))
      .filter((d) => d.length >= 10 && d.length <= 13)
      .map((d) => d.slice(-10)),
  );
  const emails = new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
  const amounts = new Set<string>();
  for (const m of text.matchAll(AMOUNT)) {
    const v = (m[1] ?? m[2] ?? '').replace(/,/g, '');
    if (v) amounts.add(String(Number(v)));
  }
  return { phones, emails, amounts };
}

const disjoint = (a: Set<string>, b: Set<string>) =>
  a.size > 0 && b.size > 0 && [...a].every((v) => !b.has(v));

/**
 * The free check: two passages from different documents that each give a phone number, an email
 * or an amount, with none in common. Pure.
 */
export function heuristicConflict(passages: ConflictPassage[]): ConflictResult {
  for (let i = 0; i < passages.length; i += 1) {
    for (let j = i + 1; j < passages.length; j += 1) {
      const a = passages[i];
      const b = passages[j];
      if (a.documentId === b.documentId) continue;
      const va = valuesOf(a.text);
      const vb = valuesOf(b.text);
      const reason: ConflictReason | null = disjoint(va.phones, vb.phones)
        ? 'phone'
        : disjoint(va.emails, vb.emails)
          ? 'email'
          : disjoint(va.amounts, vb.amounts)
            ? 'amount'
            : null;
      if (reason) return { conflict: true, passages: [a, b], reason };
    }
  }
  return { conflict: false, passages: [], reason: null };
}

/**
 * Conflict handling at answer time (stage 5). Given the top passages for a question, says
 * whether two from different documents contradict each other: the free heuristic first, then,
 * only when asked, a model judge on the top pair. A conflict is stored as an owner question in
 * the unanswered queue (`reason = 'conflict'`), so the owner fixes the sources.
 *
 * Not wired into the engine: see the stage 5 notes for where it is called.
 */
@Injectable()
export class AnswerConflictService {
  private readonly logger = LoggerService.getInstance(
    AnswerConflictService.name,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly llm?: LlmCompletionService,
  ) {}

  async detect(
    question: string,
    passages: ConflictPassage[],
    options: { useJudge?: boolean } = {},
  ): Promise<ConflictResult> {
    const top = passages.slice(0, 5);
    const quick = heuristicConflict(top);
    if (quick.conflict || !options.useJudge || !this.llm) return quick;
    const first = top[0];
    const other = top.find((p) => p.documentId !== first?.documentId);
    if (!first || !other) return quick;
    try {
      const result = await this.llm.complete({
        taskId: CONFLICT_JUDGE_TASK_ID,
        task: null,
        system:
          'Two passages from different documents were found for a question. Do they give contradicting facts on what the ' +
          'question asks (different hours, prices, numbers, addresses, rules)? Answer JSON only: {"conflict": true|false}.',
        prompt: `Question: ${question.slice(0, 500)}\n\nPassage A:\n${first.text.slice(0, 2000)}\n\nPassage B:\n${other.text.slice(0, 2000)}`,
        maxTokens: 60,
        jsonMode: true,
        timeoutMs: 10_000,
      });
      const parsed = JSON.parse(result.text || '{}') as { conflict?: unknown };
      return parsed.conflict === true
        ? { conflict: true, passages: [first, other], reason: 'judge' }
        : quick;
    } catch (error) {
      this.logger.warn(
        `Conflict judge unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return quick;
    }
  }

  /**
   * Store a conflict as an owner question on the unanswered queue. Once per person message
   * (the queue's unique message id); false when that message already has an entry.
   */
  async recordConflict(input: {
    conversationId: string;
    messageId: string;
    question: string;
    language?: string | null;
    result: ConflictResult;
  }): Promise<boolean> {
    if (!input.result.conflict) return false;
    const rows = (await this.dataSource.query(
      `INSERT INTO wa_unanswered_questions
         (message_id, conversation_id, question_text, language, reason, hit_count, status, linked_document_id, resolution_note)
       VALUES ($1, $2, $3, $4, $5, 1, 'open', $6, $7)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING id`,
      [
        input.messageId,
        input.conversationId,
        input.question.slice(0, 2000),
        input.language ?? null,
        WaUnansweredReason.CONFLICT,
        input.result.passages[0]?.documentId ?? null,
        // COPY: needs approval
        `Two of your sources disagree (${input.result.reason}): ${input.result.passages
          .map((p) => p.title || p.documentId)
          .join(' and ')}. Fix one so the assistant can answer.`,
      ],
    )) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }
}
