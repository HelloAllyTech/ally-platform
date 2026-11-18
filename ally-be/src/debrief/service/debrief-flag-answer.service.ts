import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DEBRIEF_MODELS } from '../constants/debrief-release.constants';
import { DebriefFeedbackKind } from '../enum/debrief-run.enum';
import { modelPrices } from '../util/debrief-budget.util';
import {
  ASK_ALLY_SECTION,
  cardAt,
  sectionText,
} from './debrief-feedback.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefFeedbackService } from './debrief-feedback.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';

/** The Skills Store prompt with the instructions (ally-ai default file). */
export const FLAG_ANSWER_PROMPT_CODE = 'ally_ai_debrief_flag_answer_system';
/** One answer never costs more than this (two tries of one short call). */
export const FLAG_ANSWER_BUDGET_USD = 0.05;
/** ally-ai answers in seconds; the learner hears within a minute. */
export const FLAG_ANSWER_TIMEOUT_MS = 50_000;
/** Tries per flag before it is left for a person to see in the console. */
export const FLAG_ANSWER_MAX_TRIES = 3;

interface FlagAnswerResponse {
  status: 'finished' | 'budget_spent' | 'failed';
  action?: 'keep' | 'correct' | 'remove' | null;
  correction?: Record<string, string> | null;
  reply?: string | null;
  estimated_cost_usd?: number;
  model?: string | null;
  error?: string | null;
}

/**
 * V2_AUTONOMY F1–F2: the Debrief agent answers every learner flag within a
 * minute. A new flag is answered at once (DebriefFeedbackService tells this
 * service); a 5-minute sweep picks up any that failed, up to
 * FLAG_ANSWER_MAX_TRIES. ally-ai (`POST /api/v1/debrief/flag-answers`)
 * re-reads the roleplay and the card and decides keep / correct / remove with
 * a reply in the debrief's language; DebriefFeedbackService applies it the way
 * a person's decision is applied (card versions kept, the learner told). An
 * important-moment flag is only ever kept or corrected. Each answer is
 * recorded for the PM agent (`agent_lesson_audit`, step `flag_answered`; and
 * counted in its run inputs).
 */
@Injectable()
export class DebriefFlagAnswerService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefFlagAnswerService.name,
  );
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly feedback: DebriefFeedbackService,
    private readonly context: DebriefContextRepository,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly pm?: DebriefPmAgentService,
  ) {}

  onModuleInit(): void {
    this.feedback.onFlag((flagId) => {
      void this.answer(flagId).catch((e) =>
        this.logger.warn(
          `[debrief] flag ${flagId} not answered yet: ${(e as Error).message}`,
        ),
      );
    });
    scheduledTaskRegistry.register('5min', 'debrief-flag-answer-sweep', () =>
      this.sweep().then(() => undefined),
    );
  }

  /** Flags still waiting for an answer, oldest first, that have tries left. */
  async sweep(): Promise<number> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM debrief_run_feedback
        WHERE kind = $1 AND answer IS NULL AND status IN ('open','escalated')
          AND section <> $2
          AND "createdAt" < now() - interval '1 minute'
          AND "createdAt" > now() - interval '7 days'
          AND COALESCE((SELECT count(*) FROM agent_lesson_audit a
                         WHERE a.action IN ('pipeline_step','blocked')
                           AND a.detail->>'step' = 'flag_answer_failed'
                           AND a.detail->>'flagId' = debrief_run_feedback.id::text), 0) < $3
        ORDER BY "createdAt" ASC
        LIMIT 20`,
      [DebriefFeedbackKind.FLAG, ASK_ALLY_SECTION, FLAG_ANSWER_MAX_TRIES],
    );
    let n = 0;
    for (const { id } of rows) {
      if (await this.answer(id).catch(() => null)) n++;
    }
    return n;
  }

  private async prompts(): Promise<Record<string, unknown> | null> {
    try {
      const { AiService } = await import('../../ai/service/ai.service');
      const ai = this.moduleRef.get(AiService, { strict: false });
      return await ai.getPromptOverrides([FLAG_ANSWER_PROMPT_CODE]);
    } catch {
      return null;
    }
  }

  /**
   * Answer one flag. Returns what was done, or null when there was nothing to
   * answer (withdrawn, decided, an Ask Ally item) or the answer failed (the
   * sweep tries again).
   */
  async answer(
    flagId: string,
  ): Promise<'kept' | 'corrected' | 'removed' | null> {
    if (this.inFlight.has(flagId)) return null;
    this.inFlight.add(flagId);
    try {
      const [flag] = await this.dataSource.query(
        `SELECT f.id, f."runId", f.section, f.reason, f.note, f.status, f.answer,
                r.cards, r.language, r."scenarioSessionId"
           FROM debrief_run_feedback f
           JOIN debrief_runs r ON r.id = f."runId"
          WHERE f.id = $1 AND f.kind = $2`,
        [flagId, DebriefFeedbackKind.FLAG],
      );
      if (
        !flag ||
        flag.answer ||
        !['open', 'escalated'].includes(flag.status) ||
        flag.section === ASK_ALLY_SECTION ||
        !flag.cards
      ) {
        return null;
      }
      const card =
        cardAt(flag.cards, flag.section) ??
        (sectionText(flag.cards, flag.section)
          ? { text: sectionText(flag.cards, flag.section) }
          : null);
      if (!card) return null;
      const transcript = await this.context.transcript(flag.scenarioSessionId);
      const model = DEBRIEF_MODELS.flagAnswer;
      const backup = DEBRIEF_MODELS.flagAnswerBackup;
      const prompts = await this.prompts();
      const body = {
        flag_id: flag.id,
        run_id: flag.runId,
        language: flag.language ?? 'en',
        section: flag.section,
        reason: flag.reason ?? null,
        note: flag.note ?? null,
        card,
        transcript: transcript.map((t) => ({
          turn_index: t.turn_index,
          role: t.role,
          text: t.text,
        })),
        model,
        backup_model: backup,
        prices: modelPrices([model, backup]),
        budget_usd: FLAG_ANSWER_BUDGET_USD,
        ...(prompts ? { prompts } : {}),
      };
      const res = await this.call(body);
      if (res.status !== 'finished' || !res.action || !res.reply) {
        await this.pm?.audit('blocked', null, null, {
          step: 'flag_answer_failed',
          flagId,
          runId: flag.runId,
          status: res.status,
          error: res.error ?? null,
        });
        return null;
      }
      const saved = await this.feedback.applyAgentAnswer(flagId, {
        action: res.action,
        reply: res.reply,
        correction: res.correction ?? null,
        model: res.model ?? null,
        costUsd: res.estimated_cost_usd ?? null,
      });
      if (!saved?.answer) return null;
      // F2: the PM agent's evidence (no learner words: the section, the
      // learner's reason code and what was done).
      await this.pm?.audit('pipeline_step', null, null, {
        step: 'flag_answered',
        flagId,
        runId: flag.runId,
        section: flag.section,
        reason: flag.reason ?? null,
        action: saved.answer.action,
        model: res.model ?? null,
        costUsd: res.estimated_cost_usd ?? null,
      });
      return saved.answer.action;
    } catch (e) {
      await this.pm
        ?.audit('blocked', null, null, {
          step: 'flag_answer_failed',
          flagId,
          error: (e as Error).message.slice(0, 300),
        })
        .catch(() => undefined);
      throw e;
    } finally {
      this.inFlight.delete(flagId);
    }
  }

  private async call(
    body: Record<string, unknown>,
  ): Promise<FlagAnswerResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    const res = await axios.post(
      `${apiUrl}/api/v1/debrief/flag-answers`,
      body,
      {
        headers: { 'x-api-key': outboundApiKey },
        timeout: FLAG_ANSWER_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );
    return res.data as FlagAnswerResponse;
  }
}
