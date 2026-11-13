import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import axios, { AxiosError } from 'axios';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import {
  builderRequesters,
  DEBRIEF_PM_AGENT_REQUESTER,
} from '../../builder/util/builder-requesters.registry';
import { buildDecisionId } from '../../builder/type/builder-decision.type';
import type { BuilderQuestionEvent } from '../../builder/type/builder-sse.type';
import type { BuilderDecisionService } from '../../builder/service/builder-decision.service';
import { pmAgentAutonomy } from '../constants/debrief-owner-settings.constants';
import { DEBRIEF_MODELS } from '../constants/debrief-release.constants';
import { modelPrices } from '../util/debrief-budget.util';
import { stripQuotes } from '../util/debrief-pm-agent-rules.util';
import {
  BUILDER_ANSWER_CAP_USD,
  BUILDER_ANSWERS_PER_SESSION,
  BuilderProgressStage,
  builderProgressStage,
} from '../util/debrief-builder-progress.util';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefPmAgentToolsService } from './debrief-pm-agent-tools.service';
import { DebriefSettingsService } from './debrief-settings.service';

/** An ally-ai call is one model call; past this ally-be stops waiting. */
const ANSWER_TIMEOUT_MS = 90_000;

/** One answer the PM agent sent Builder, kept on the idea for "See the PM agent's answers". */
export interface PmAgentBuilderAnswer {
  questionId: string;
  question: string;
  answer: string;
  at: string;
}

/** A question the PM agent left for the person, with why. */
export interface PmAgentBuilderEscalation {
  questionId: string;
  question: string;
  reason: string;
  at: string;
}

interface BuilderRecord {
  answers: PmAgentBuilderAnswer[];
  escalated: PmAgentBuilderEscalation[];
  costUsd: number;
}

/** `POST /api/v1/pm-agent/builder-answers` (CONTRACT.md §7b). */
interface BuilderAnswersResponse {
  status: 'finished' | 'budget_spent' | 'failed';
  answers: Array<{
    question_id: string;
    can_answer: boolean;
    selected_option_ids: string[];
    answer: string;
    reason: string;
  }>;
  estimated_cost_usd?: number;
  model?: string | null;
  error?: string | null;
}

/** What the idea card shows once an idea is with Builder. */
export interface BuilderProgressView {
  sessionId: string;
  answerer: 'pm_agent' | 'person';
  stage: BuilderProgressStage;
  sessionStatus: string | null;
  /** What Builder waits on a person for, if anything the card can show. */
  waiting:
    | {
        kind: 'question';
        questionId: string;
        prompt: string;
        options: Array<{ id: string; label: string }>;
        /** The PM agent left it for the person: why. Null in "I'll answer" mode. */
        reason: string | null;
      }
    | { kind: 'brief' }
    | { kind: 'pm_agent' }
    | null;
  answers: PmAgentBuilderAnswer[];
  pullRequests: Array<{
    repo: string;
    number: number;
    url: string;
    state: string | null;
    merged: boolean;
  }>;
}

const emptyRecord = (): BuilderRecord => ({
  answers: [],
  escalated: [],
  costUsd: 0,
});

/**
 * "Hand to Builder" (R2-20, plan §11.5): the PM agent as Builder's requester.
 *
 * Registered with Builder as the `debrief_pm_agent` requester. When an interview
 * turn ends on a session handed over with "The PM agent" answering, Builder's
 * pending question goes to ally-ai with the idea's brief (written by the PM agent,
 * quotes already stripped) and nothing else. An answer goes back to Builder the way
 * a person's answer from the feed does (`BuilderDecisionService.answer`, surface
 * `requester`); a question the brief does not settle stays where Builder put it, for
 * the person who clicked — in Builder, exactly as Builder asks people today. Builder's
 * situation brief (claims about the code) is always left for a person.
 *
 * Paid from the learning budget (the call is recorded to `llm_usage` as
 * `debrief_improver`), at most BUILDER_ANSWER_CAP_USD each, never while the PM agent
 * is switched off. Builder never receives a learner's words: the brief is
 * quote-stripped, every answer is stripped again here against the cited comments,
 * and an answer that quoted anyone is not sent at all.
 */
@Injectable()
export class DebriefBuilderRequesterService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefBuilderRequesterService.name,
  );
  /** Sessions with an answer in flight on this instance. */
  private readonly busy = new Set<string>();
  /** A turn ended while that session was busy: look again once it is not. */
  private readonly again = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly pm: DebriefPmAgentService,
    private readonly tools: DebriefPmAgentToolsService,
    private readonly ownerSettings: DebriefSettingsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    builderRequesters.register(DEBRIEF_PM_AGENT_REQUESTER, {
      turnEnded: (sessionId, ideaId) => this.turnEnded(sessionId, ideaId),
    });
  }

  /** Resolved lazily: Builder imports far more than the debrief needs. */
  private async decisions(): Promise<BuilderDecisionService> {
    const { BuilderDecisionService: Service } =
      await import('../../builder/service/builder-decision.service');
    return this.moduleRef.get(Service, { strict: false });
  }

  /** The handed-over idea for this session, when the PM agent answers it. */
  private async ideaFor(
    sessionId: string,
    ideaId: string | null,
  ): Promise<Record<string, any> | null> {
    if (!ideaId) return null;
    let idea: Record<string, any>;
    try {
      idea = await this.pm.getIdea(ideaId);
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
    const h = idea.evidence?.handoff;
    if (h?.kind !== 'builder' || h.filedId !== sessionId) return null;
    if (['rejected', 'retired'].includes(idea.status)) return null;
    return idea;
  }

  async turnEnded(sessionId: string, ideaId: string | null): Promise<void> {
    if (this.busy.has(sessionId)) {
      this.again.add(sessionId);
      return;
    }
    this.busy.add(sessionId);
    try {
      await this.answerPending(sessionId, ideaId);
    } finally {
      this.busy.delete(sessionId);
      if (this.again.delete(sessionId)) {
        void this.turnEnded(sessionId, ideaId).catch((e) =>
          this.logger.warn(
            `[pm-agent] Builder answer for ${sessionId} failed: ${(e as Error).message}`,
          ),
        );
      }
    }
  }

  private async answerPending(
    sessionId: string,
    ideaId: string | null,
  ): Promise<void> {
    const idea = await this.ideaFor(sessionId, ideaId);
    if (!idea || idea.evidence.handoff.answerer !== 'pm_agent') return;
    const decisions = await this.decisions();
    const pending = await decisions.pendingInterview(sessionId);
    const question = pending.questions[0];
    // A situation brief is Builder's reading of the code: a person confirms it.
    if (pending.brief || !question) return;
    const record: BuilderRecord = {
      ...emptyRecord(),
      ...(idea.evidence.builder ?? {}),
    };
    if (record.escalated.some((e) => e.questionId === question.id)) return;
    const blocked = await this.cannotAnswer(record);
    if (blocked) {
      await this.escalate(idea.id, record, question, blocked);
      return;
    }
    await this.answer(idea, record, question, decisions, sessionId);
  }

  /** Why the PM agent may not answer now, or null when it may. */
  private async cannotAnswer(record: BuilderRecord): Promise<string | null> {
    if (record.answers.length >= BUILDER_ANSWERS_PER_SESSION) {
      return `The PM agent has answered ${BUILDER_ANSWERS_PER_SESSION} questions on this session; the rest come to you.`;
    }
    const settings = await this.ownerSettings.get();
    if (pmAgentAutonomy(settings) === 'off') {
      return 'The PM agent is switched off.';
    }
    if ((await this.budgetUsd()) <= 0) {
      return "This month's learning budget is spent.";
    }
    return null;
  }

  private async budgetUsd(): Promise<number> {
    const settings = await this.ownerSettings.get();
    const left =
      (await this.pm.learningBudgetThisMonth()) -
      (await this.pm.learningSpentThisMonth());
    const usd = Math.min(
      settings.pmAgentRunCapUsd,
      BUILDER_ANSWER_CAP_USD,
      left,
    );
    return Math.max(0, Math.round(usd * 100) / 100);
  }

  private async answer(
    idea: Record<string, any>,
    record: BuilderRecord,
    question: BuilderQuestionEvent,
    decisions: BuilderDecisionService,
    sessionId: string,
  ): Promise<void> {
    const h = idea.evidence.handoff;
    const known = await this.tools.knownTexts(idea);
    const clean = (v: unknown) => stripQuotes(String(v ?? ''), known).text;
    const body = {
      idea_id: idea.id,
      model: DEBRIEF_MODELS.pmAgent,
      backup_model: DEBRIEF_MODELS.pmAgentBackup,
      prices: modelPrices([
        DEBRIEF_MODELS.pmAgent,
        DEBRIEF_MODELS.pmAgentBackup,
      ]),
      budget_usd: await this.budgetUsd(),
      brief: {
        title: clean(idea.text),
        problem: clean(h.problem),
        evidence_summary: clean(h.evidenceSummary),
        expected_effect: clean(h.expectedEffect),
        acceptance_checks: ((h.acceptanceChecks ?? []) as string[]).map(clean),
      },
      questions: [
        {
          id: question.id,
          prompt: question.prompt,
          rationale: question.rationale ?? null,
          options: (question.options ?? []).map((o) => ({
            id: o.id,
            label: o.label,
            description: o.description ?? null,
          })),
        },
      ],
      known_texts: known,
    };
    let res: BuilderAnswersResponse;
    try {
      res = await this.call(body);
    } catch (e) {
      res = {
        status: 'failed',
        answers: [],
        error: (e as Error).message.slice(0, 300),
      };
    }
    const cost = Number(res.estimated_cost_usd ?? 0);
    record.costUsd = Math.round((record.costUsd + cost) * 10000) / 10000;
    await this.pm.audit('pipeline_step', idea.id, null, {
      step: 'builder_answer',
      sessionId,
      questionId: question.id,
      status: res.status,
      model: res.model ?? null,
      costUsd: cost,
      error: res.error ?? null,
    });
    const got = res.answers.find((a) => a.question_id === question.id);
    const stripped = stripQuotes(got?.answer ?? '', known);
    const options = new Set((question.options ?? []).map((o) => o.id));
    const picked = (got?.selected_option_ids ?? []).filter((id) =>
      options.has(id),
    );
    const text = stripped.text.trim();
    if (
      res.status !== 'finished' ||
      !got?.can_answer ||
      stripped.removed > 0 ||
      (!text && !picked.length)
    ) {
      const reason =
        res.status === 'budget_spent'
          ? "This month's learning budget is spent."
          : res.status === 'failed'
            ? 'The PM agent could not answer just now.'
            : stripped.removed > 0
              ? 'The answer quoted someone, so it was not sent.'
              : stripQuotes(got?.reason ?? '', known).text.trim() ||
                'The brief does not settle this.';
      await this.escalate(idea.id, record, question, reason);
      return;
    }
    const message = text ? `From the PM agent: ${text}` : '';
    const labels = (question.options ?? [])
      .filter((o) => picked.includes(o.id))
      .map((o) => o.label);
    // Recorded before the answer goes: Builder's next turn can end (and read
    // this record) before `answer` returns.
    record.answers.push({
      questionId: question.id,
      question: question.prompt,
      answer: [...labels, ...(text ? [text] : [])].join(' · '),
      at: new Date().toISOString(),
    });
    await this.pm.writeEvidence(idea.id, 'builder', { ...record });
    try {
      await decisions.answer(
        buildDecisionId('question', sessionId, question.id),
        {
          ...(picked.length ? { selectedOptionIds: picked } : {}),
          ...(message ? { message } : {}),
        },
        Number(idea.evidence.handoff.decidedBy ?? idea.decidedBy),
        { surface: 'requester' },
      );
    } catch (e) {
      // Someone answered it first, or Builder moved on: the answer was not sent.
      record.answers.pop();
      await this.pm.writeEvidence(idea.id, 'builder', { ...record });
      if (e instanceof ConflictException) return;
      throw e;
    }
  }

  private async escalate(
    ideaId: string,
    record: BuilderRecord,
    question: BuilderQuestionEvent,
    reason: string,
  ): Promise<void> {
    record.escalated.push({
      questionId: question.id,
      question: question.prompt,
      reason,
      at: new Date().toISOString(),
    });
    await this.pm.writeEvidence(ideaId, 'builder', { ...record });
    await this.pm.audit('pipeline_step', ideaId, null, {
      step: 'builder_escalated',
      questionId: question.id,
      reason,
    });
  }

  private async call(
    body: Record<string, unknown>,
  ): Promise<BuilderAnswersResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(
        `${apiUrl}/api/v1/pm-agent/builder-answers`,
        body,
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: ANSWER_TIMEOUT_MS,
        },
      );
      return res.data as BuilderAnswersResponse;
    } catch (e) {
      const err = e as AxiosError<{ detail?: unknown }>;
      throw new Error(
        `pm agent builder answers ${err.response?.status ?? 'network'}: ${err.message}`,
      );
    }
  }

  // --- The idea card ----------------------------------------------------------------

  /** Where a handed-over idea stands in Builder (the idea card's progress line). */
  async progress(ideaId: string): Promise<BuilderProgressView> {
    const idea = await this.pm.getIdea(ideaId);
    const h = idea.evidence?.handoff;
    if (h?.kind !== 'builder' || h.status !== 'filed' || !h.filedId) {
      throw new NotFoundException('this idea has not been handed to Builder');
    }
    const sessionId: string = h.filedId;
    const answerer: 'pm_agent' | 'person' =
      h.answerer === 'pm_agent' ? 'pm_agent' : 'person';
    const [session] = await this.dataSource.query(
      `SELECT status FROM builder_sessions WHERE id = $1 AND "deletedAt" IS NULL`,
      [sessionId],
    );
    const prs: Array<{
      repo: string;
      prNumber: number;
      prUrl: string;
      state: string | null;
      merged: boolean;
    }> = await this.dataSource.query(
      `SELECT repo, "prNumber", "prUrl", state, merged FROM builder_pull_requests
        WHERE "sessionId" = $1 ORDER BY "createdAt"`,
      [sessionId],
    );
    const status: string | null = session?.status ?? null;
    const record: BuilderRecord = {
      ...emptyRecord(),
      ...(idea.evidence.builder ?? {}),
    };
    let waiting: BuilderProgressView['waiting'] = null;
    if (status === 'INTERVIEWING' || status === 'PRD_READY') {
      try {
        const pending = await (
          await this.decisions()
        ).pendingInterview(sessionId);
        const q = pending.questions[0];
        if (pending.brief) waiting = { kind: 'brief' };
        else if (q) {
          const left = record.escalated.find((e) => e.questionId === q.id);
          waiting =
            answerer === 'pm_agent' && !left
              ? { kind: 'pm_agent' }
              : {
                  kind: 'question',
                  questionId: q.id,
                  prompt: q.prompt,
                  options: (q.options ?? []).map((o) => ({
                    id: o.id,
                    label: o.label,
                  })),
                  reason: left?.reason ?? null,
                };
        }
      } catch (e) {
        this.logger.warn(
          `[pm-agent] could not read Builder session ${sessionId}: ${(e as Error).message}`,
        );
      }
    }
    return {
      sessionId,
      answerer,
      stage: builderProgressStage(status, prs),
      sessionStatus: status,
      waiting,
      answers: record.answers,
      pullRequests: prs.map((pr) => ({
        repo: pr.repo,
        number: pr.prNumber,
        url: pr.prUrl,
        state: pr.state,
        merged: !!pr.merged,
      })),
    };
  }

  /**
   * The person answers Builder's question from the idea card ("Send to Builder"):
   * the same answer the Builder feed would send, as them.
   */
  async answerAsPerson(
    ideaId: string,
    userId: number,
    questionId: string,
    text: string,
  ): Promise<{ ok: true }> {
    const view = await this.progress(ideaId);
    if (
      view.waiting?.kind !== 'question' ||
      view.waiting.questionId !== questionId
    ) {
      throw new ConflictException(
        'Builder has moved on from that question. Open the Builder session to see where it is.',
      );
    }
    await (
      await this.decisions()
    ).answer(
      buildDecisionId('question', view.sessionId, questionId),
      { message: text.trim() },
      userId,
      { surface: 'session' },
    );
    return { ok: true };
  }
}
