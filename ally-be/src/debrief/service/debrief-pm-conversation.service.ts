import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_MODELS,
} from '../constants/debrief-release.constants';
import {
  DebriefPmMessage,
  PmAbout,
  PmPlan,
  PmTurnAction,
} from '../entity/debrief-pm-message.entity';
import { modelPrices } from '../util/debrief-budget.util';
import {
  DebriefAction,
  DebriefViewer,
} from '../util/debrief-console-roles.util';
import { changeKindOf } from '../util/debrief-console-view.util';
import {
  alwaysAskReasons,
  changeName,
  conversationAccess,
  isExplicitYes,
  isPinnedRuleChange,
  MAX_MESSAGE_CHARS,
  PmMessageView,
  requiredAction,
  toPmMessage,
  whoDecides,
} from '../util/debrief-pm-conversation.util';
import {
  DebriefChangeHoldsService,
  normaliseLanguages,
  PAUSABLE_KINDS,
} from './debrief-change-holds.service';
import { DebriefConsoleViewService } from './debrief-console-view.service';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import {
  DebriefAgentClaims,
  DebriefRunTokenService,
  PmAgentGatewayTool,
  PmConversationTool,
} from './debrief-run-token.service';
import { DebriefSettingsService } from './debrief-settings.service';

/** The Skills Store prompt with the conversation's instructions (ally-ai default file). */
export const PM_CONVERSATION_PROMPT_CODE =
  'ally_ai_debrief_pm_conversation_system';
/** One answer never spends more than this from the learning budget. */
export const CONVERSATION_TURN_CAP_USD = 0.25;
/** ally-ai answers within ~10–30 s; past this the turn is failed. */
export const CONVERSATION_TIMEOUT_MS = 120_000;
/** Thread messages sent as context. */
const HISTORY = 20;
/** A plan older than this needs asking again. */
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every tool a full conversation turn is given. */
export const CONVERSATION_TURN_TOOLS: readonly PmAgentGatewayTool[] = [
  'comments_read',
  'reporting_query',
  'metrics_view',
  'idea_propose',
  'release_draft',
  'ladder_start_quick_test',
  'change_read',
  'session_read',
  'change_approve',
  'change_turn_down',
  'change_stop',
  'change_undo',
  'change_retry',
  'change_hold_language',
  'changes_pause',
  'confirm_plan',
];
/** The clinical advisor's turn: read and decide pinned-rule changes, nothing else. */
export const ADVISOR_TURN_TOOLS: readonly PmAgentGatewayTool[] = [
  'change_read',
  'change_approve',
  'change_turn_down',
  'confirm_plan',
];

/** A refusal the agent reads (200 `{ refused }`) and relays in plain words. */
class Refused extends Error {}
const refuse = (reason: string): never => {
  throw new Refused(reason);
};

interface PmConversationResponse {
  status: 'finished' | 'budget_spent' | 'failed';
  reply?: string | null;
  estimated_cost_usd?: number;
  model?: string | null;
  steps?: Array<Record<string, unknown>>;
  refusals?: Array<{ tool: string; reason: string }>;
  error?: string | null;
}

/**
 * The Debrief console's one PM agent conversation (V2_AUTONOMY C1–C3): one
 * shared thread in `debrief_pm_messages`. A person's message runs the PM
 * agent in ally-ai (`POST /api/v1/pm-agent/conversation`) with the recent
 * thread, what the person is looking at and its evidence, and a token for the
 * conversation's tools. The agent replies and acts only through those tools,
 * served here; each action is recorded on the person's message, on the change
 * (`evidence.conversation`) and in the audit with the person's words.
 *
 * Permissions are today's (debrief-console-roles.util.ts): the Ally team and
 * the owner (`pmAgent`) read and post; the clinical advisor only about
 * pinned-rule changes. Approving or turning down a change is repeated back and
 * waits for the same person's explicit yes; then it runs as that person, and
 * only if they hold the permission — a pinned rule the advisor's or owner's,
 * a budget increase the owner's — otherwise the agent says so and asks them.
 */
@Injectable()
export class DebriefPmConversationService {
  private readonly logger = LoggerService.getInstance(
    DebriefPmConversationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefPmMessage)
    private readonly messages: Repository<DebriefPmMessage>,
    private readonly config: AppConfigService,
    private readonly tokens: DebriefRunTokenService,
    private readonly pm: DebriefPmAgentService,
    private readonly holds: DebriefChangeHoldsService,
    private readonly view: DebriefConsoleViewService,
    private readonly ownerSettings: DebriefSettingsService,
    private readonly releases: AgentReleaseService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly notifier?: DebriefNotifier,
  ) {}

  // --- the thread ---------------------------------------------------------------------

  /** Pinned-rule changes' ids: the advisor's whole view of the thread. */
  private async pinnedRuleIdeaIds(): Promise<string[]> {
    const rows: Array<{ id: string; change: Record<string, any> }> =
      await this.dataSource.query(
        `SELECT id, change FROM agent_lessons WHERE "agentKey" = $1`,
        [DEBRIEF_AGENT_KEY],
      );
    return rows.filter((r) => isPinnedRuleChange(r)).map((r) => r.id);
  }

  /**
   * `GET pm-agent/conversation?before&limit&about`: newest page, oldest first.
   * `about` (a change id) narrows to the messages about that change. The
   * clinical advisor sees only messages about pinned-rule changes.
   */
  async list(
    viewer: DebriefViewer,
    opts: { before?: string; limit?: number; about?: string },
  ): Promise<{ messages: PmMessageView[]; more: boolean }> {
    const access = conversationAccess(viewer.can);
    if (access === 'none') {
      throw new ForbiddenException('You cannot read the PM agent conversation');
    }
    const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
    const qb = this.messages.createQueryBuilder('m');
    if (opts.about) {
      if (!UUID.test(opts.about)) {
        throw new BadRequestException('about must be a change id');
      }
      qb.andWhere(`m.about->>'id' = :about`, { about: opts.about });
    }
    if (access === 'pinned_rules') {
      const ids = await this.pinnedRuleIdeaIds();
      if (!ids.length) return { messages: [], more: false };
      qb.andWhere(`m.about->>'kind' = 'change'`).andWhere(
        `m.about->>'id' IN (:...ids)`,
        { ids },
      );
    }
    if (opts.before) {
      if (!UUID.test(opts.before)) {
        throw new BadRequestException('before must be a message id');
      }
      const anchor = await this.messages.findOne({
        where: { id: opts.before },
      });
      if (anchor) {
        qb.andWhere('m."createdAt" < :at', { at: anchor.createdAt });
      }
    }
    const rows = await qb
      .orderBy('m."createdAt"', 'DESC')
      .addOrderBy('m.who', 'ASC')
      .take(limit + 1)
      .getMany();
    const more = rows.length > limit;
    return {
      messages: rows.slice(0, limit).reverse().map(toPmMessage),
      more,
    };
  }

  private async userName(userId: number): Promise<string | null> {
    const [u] = await this.dataSource
      .query(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), email) AS name FROM users WHERE id = $1`,
        [userId],
      )
      .catch(() => []);
    return u?.name ?? null;
  }

  /** The about a person sent, checked: a change or session id must exist. */
  private async cleanAbout(about?: PmAbout | null): Promise<PmAbout | null> {
    if (!about || !about.kind) return null;
    if (!['change', 'session', 'page'].includes(about.kind)) {
      throw new BadRequestException('about.kind is change, session or page');
    }
    const label = String(about.label ?? '')
      .trim()
      .slice(0, 200);
    if (about.kind === 'page') return { kind: 'page', label: label || 'Page' };
    if (!about.id || !UUID.test(about.id)) {
      throw new BadRequestException(`about.id must be a ${about.kind} id`);
    }
    return { kind: about.kind, id: about.id, label: label || about.kind };
  }

  /**
   * `POST pm-agent/conversation { text, about }`: stores the person's message,
   * runs the PM agent in ally-ai, stores its reply with the action it took,
   * and returns both. Never throws for an agent failure: the reply says so.
   */
  async post(
    viewer: DebriefViewer,
    input: { text: string; about?: PmAbout | null },
  ): Promise<{ messages: PmMessageView[] }> {
    const text = String(input.text ?? '').trim();
    if (!text) throw new BadRequestException('Write a message first');
    const about = await this.cleanAbout(input.about);
    const access = conversationAccess(viewer.can);
    if (access === 'none') {
      throw new ForbiddenException('You cannot talk to the PM agent');
    }
    if (access === 'pinned_rules') {
      const idea =
        about?.kind === 'change' && about.id
          ? await this.pm.getIdea(about.id).catch(() => null)
          : null;
      if (!idea || !isPinnedRuleChange(idea)) {
        throw new ForbiddenException(
          'The clinical advisor talks to the PM agent about pinned-rule changes only. Open the change from Home.',
        );
      }
    }
    const authorName = await this.userName(viewer.userId);
    const person = await this.messages.save(
      this.messages.create({
        who: 'person',
        authorUserId: viewer.userId,
        authorName,
        text: text.slice(0, MAX_MESSAGE_CHARS),
        about,
        actions: [],
      }),
    );
    const reply = await this.answer(person, access, about);
    return { messages: [toPmMessage(person), toPmMessage(reply)] };
  }

  /** The plan waiting for this person's yes, from the agent's last message to them. */
  private async pendingPlan(before: Date): Promise<DebriefPmMessage | null> {
    const last = await this.messages
      .createQueryBuilder('m')
      .where(`m.who = 'agent'`)
      .andWhere('m."createdAt" < :at', { at: before })
      .orderBy('m."createdAt"', 'DESC')
      .getOne();
    const plan = last?.plan;
    if (!plan || plan.usedAt) return null;
    if (Date.now() - new Date(plan.at).getTime() > PLAN_TTL_MS) return null;
    return last!;
  }

  private async turnBudget(): Promise<number> {
    const settings = await this.ownerSettings.get();
    const left =
      (await this.pm.learningBudgetThisMonth()) -
      (await this.pm.learningSpentThisMonth());
    const usd = Math.min(
      settings.pmAgentRunCapUsd,
      CONVERSATION_TURN_CAP_USD,
      left,
    );
    return Math.max(0, Math.round(usd * 100) / 100);
  }

  /** The evidence for what the person is looking at. */
  private async aboutEvidence(
    about: PmAbout | null,
  ): Promise<Record<string, unknown> | null> {
    if (!about) return null;
    try {
      if (about.kind === 'change' && about.id) {
        return { ...about, evidence: await this.changeRead(about.id) };
      }
      if (about.kind === 'session' && about.id) {
        return { ...about, evidence: await this.sessionRead(about.id) };
      }
    } catch {
      // A change or session that cannot be read is still named.
    }
    return { ...about };
  }

  private async answer(
    person: DebriefPmMessage,
    access: 'all' | 'pinned_rules',
    about: PmAbout | null,
  ): Promise<DebriefPmMessage> {
    const history = (
      await this.messages
        .createQueryBuilder('m')
        .where('m."createdAt" < :at', { at: person.createdAt })
        .orderBy('m."createdAt"', 'DESC')
        .take(HISTORY)
        .getMany()
    )
      .reverse()
      .filter((m) =>
        access === 'all' ? true : m.about?.id && m.about.id === about?.id,
      );
    const pending = await this.pendingPlan(person.createdAt);
    const budgetUsd = await this.turnBudget();
    let res: PmConversationResponse;
    if (budgetUsd <= 0) {
      res = {
        status: 'budget_spent',
        reply:
          "This month's learning budget is spent, so I can't look into this now. The owner can raise it in Settings › Budgets.",
      };
    } else {
      const tools =
        access === 'all' ? CONVERSATION_TURN_TOOLS : ADVISOR_TURN_TOOLS;
      const model = DEBRIEF_MODELS.pmAgent;
      const backup = DEBRIEF_MODELS.pmAgentBackup;
      const body = {
        turn_id: person.id,
        model,
        backup_model: backup,
        prices: modelPrices([model, backup]),
        budget_usd: budgetUsd,
        history: history.map((m) => ({
          who: m.who,
          author: m.who === 'person' ? (m.authorName ?? null) : null,
          text: m.text,
          about: m.about ?? null,
          action: m.action ?? null,
        })),
        message: person.text,
        author: person.authorName ?? null,
        about: await this.aboutEvidence(about),
        pending_plan:
          pending?.plan && pending.plan.askedUserId === person.authorUserId
            ? {
                plan_id: pending.plan.id,
                plan: pending.plan.text,
                action: pending.plan.label,
              }
            : null,
        tools: [...tools],
        agent_token: this.tokens.signAgent(person.id, tools, 15 * 60),
        gateway_url: this.tokens.gatewayUrl(),
      };
      try {
        const prompts = await this.prompts();
        res = await this.call({ ...body, ...(prompts ? { prompts } : {}) });
      } catch (e) {
        res = {
          status: 'failed',
          reply: "I couldn't answer just now. Please try again in a minute.",
          error: (e as Error).message.slice(0, 300),
        };
      }
    }
    await this.recordProposals(person);
    const fresh = await this.messages.findOne({ where: { id: person.id } });
    const actions = (fresh?.actions ?? []) as PmTurnAction[];
    // The action the reply shows: the turn's last one (a plan waiting for a
    // yes, or what was done or refused), from the gateway's record.
    const last = actions[actions.length - 1] ?? null;
    const reply = await this.messages.save(
      this.messages.create({
        who: 'agent',
        text:
          (res.reply ?? '').trim().slice(0, MAX_MESSAGE_CHARS) ||
          "I couldn't answer just now. Please try again in a minute.",
        about,
        action: last ? { label: last.label, status: last.status } : null,
        actions: [],
        plan: await this.planFor(person, last),
        replyTo: person.id,
        status: res.status,
        model: res.model ?? null,
        costUsd:
          res.estimated_cost_usd != null
            ? String(res.estimated_cost_usd)
            : null,
      }),
    );
    await this.pm.audit('pipeline_step', null, person.authorUserId ?? null, {
      step: 'conversation_turn',
      messageId: person.id,
      replyId: reply.id,
      status: res.status,
      actions: actions.map((a) => ({
        tool: a.tool,
        status: a.status,
        ideaId: a.ideaId ?? null,
      })),
      costUsd: res.estimated_cost_usd ?? null,
      refusals: res.refusals ?? [],
      error: res.error ?? null,
    });
    return reply;
  }

  /** Plans made during this turn are kept on the person's message until the reply carries them. */
  private async planFor(
    person: DebriefPmMessage,
    last: PmTurnAction | null,
  ): Promise<PmPlan | null> {
    if (!last || last.status !== 'awaiting_yes' || !last.planId) return null;
    const [row] = await this.dataSource.query(
      `SELECT plan FROM debrief_pm_messages WHERE id = $1`,
      [person.id],
    );
    const plan = row?.plan as PmPlan | null;
    return plan && plan.id === last.planId ? plan : null;
  }

  /** Changes the agent proposed this turn (`idea_propose` keeps the turn id). */
  private async recordProposals(person: DebriefPmMessage): Promise<void> {
    const rows: Array<{ id: string; text: string }> = await this.dataSource
      .query(
        `SELECT id, text FROM agent_lessons
          WHERE "agentKey" = $1 AND evidence->>'agentRunId' = $2`,
        [DEBRIEF_AGENT_KEY, person.id],
      )
      .catch(() => []);
    for (const r of rows) {
      await this.record(person, {
        tool: 'idea_propose',
        ideaId: r.id,
        label: `Proposed ${changeName(r)}`,
        status: 'done',
      });
    }
  }

  private async prompts(): Promise<Record<string, unknown> | null> {
    try {
      const { AiService } = await import('../../ai/service/ai.service');
      const ai = this.moduleRef.get(AiService, { strict: false });
      return await ai.getPromptOverrides([PM_CONVERSATION_PROMPT_CODE]);
    } catch {
      // ally-ai falls back to its default instructions.
      return null;
    }
  }

  private async call(
    body: Record<string, unknown>,
  ): Promise<PmConversationResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(
        `${apiUrl}/api/v1/pm-agent/conversation`,
        body,
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: CONVERSATION_TIMEOUT_MS,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
      return res.data as PmConversationResponse;
    } catch (e) {
      const err = e as AxiosError<{ detail?: unknown }>;
      throw new Error(
        `pm conversation ${err.response?.status ?? 'network'}: ${err.message}`,
      );
    }
  }

  // --- recording actions -----------------------------------------------------------------

  /**
   * One action of a turn: on the person's message, on the change's evidence
   * (`evidence.conversation`, with the person's words) and in the audit.
   */
  private async record(
    person: DebriefPmMessage,
    a: Omit<PmTurnAction, 'at'>,
  ): Promise<PmTurnAction> {
    const entry: PmTurnAction = { ...a, at: new Date().toISOString() };
    await this.dataSource.query(
      `UPDATE debrief_pm_messages SET actions = actions || jsonb_build_array($2::jsonb),
              "updatedAt" = now() WHERE id = $1`,
      [person.id, JSON.stringify(entry)],
    );
    if (a.ideaId) {
      const log = {
        at: entry.at,
        by: person.authorUserId ?? null,
        name: person.authorName ?? null,
        words: person.text.slice(0, 1000),
        tool: a.tool,
        label: a.label,
        status: a.status,
        messageId: person.id,
      };
      await this.dataSource
        .query(
          `UPDATE agent_lessons
              SET evidence = jsonb_set(coalesce(evidence, '{}'::jsonb), '{conversation}',
                    coalesce(evidence->'conversation', '[]'::jsonb) || jsonb_build_array($2::jsonb)),
                  "updatedAt" = now()
            WHERE id = $1::uuid`,
          [a.ideaId, JSON.stringify(log)],
        )
        .catch(() => undefined);
    }
    await this.pm.audit(
      a.status === 'failed' ? 'blocked' : 'pipeline_step',
      a.ideaId ?? null,
      person.authorUserId ?? null,
      {
        step: `conversation_${a.tool}`,
        agentRunId: person.id,
        status: a.status,
        label: a.label,
        personWords: person.text.slice(0, 1000),
      },
    );
    return entry;
  }

  // --- the gateway tools ------------------------------------------------------------------

  /**
   * A conversation tool call from ally-ai. `claims.agentRunId` is the person's
   * message: who asked, in what words, with which permissions. A refusal
   * answers 200 `{ refused }` (recorded as a failed action when it was one).
   */
  async callTool(
    tool: PmConversationTool,
    claims: DebriefAgentClaims,
    body: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    const b = body ?? {};
    const person = await this.messages.findOne({
      where: { id: claims.agentRunId, who: 'person' },
    });
    if (!person) return { refused: 'this conversation turn is not known' };
    try {
      const viewer = await this.view.viewer(person.authorUserId ?? -1);
      const access = conversationAccess(viewer.can);
      switch (tool) {
        case 'change_read':
          return await this.changeRead(this.ideaId(b), access);
        case 'session_read':
          if (access !== 'all') refuse('you can read pinned-rule changes only');
          return await this.sessionRead(this.uuid(b.run_id, 'run_id'));
        case 'change_approve':
        case 'change_turn_down':
          return await this.planDecision(tool, person, viewer, b);
        case 'confirm_plan':
          return await this.confirm(person, viewer, String(b.plan_id ?? ''));
        default:
          if (access !== 'all') {
            refuse(
              'the clinical advisor decides pinned-rule changes only; the Ally team does the rest',
            );
          }
          return await this.act(tool, person, viewer, b);
      }
    } catch (e) {
      const reason =
        e instanceof Refused
          ? e.message
          : e instanceof HttpException && e.getStatus() < 500
            ? e.message
            : null;
      if (reason == null) throw e;
      if (
        b.idea_id &&
        !['change_read', 'session_read'].includes(tool) &&
        !(e as { recorded?: boolean }).recorded
      ) {
        await this.record(person, {
          tool,
          ideaId: UUID.test(String(b.idea_id)) ? String(b.idea_id) : null,
          label: `Could not ${verb(tool)}: ${reason}`.slice(0, 300),
          status: 'failed',
        });
      }
      return { refused: reason };
    }
  }

  private uuid(v: unknown, name: string): string {
    if (typeof v !== 'string' || !UUID.test(v)) refuse(`${name} is not an id`);
    return v as string;
  }

  private ideaId(b: Record<string, any>): string {
    return this.uuid(b.idea_id, 'idea_id');
  }

  /** `change_read`: one change in full, for the agent and the context. */
  async changeRead(
    ideaId: string,
    access: 'all' | 'pinned_rules' | 'none' = 'all',
  ): Promise<Record<string, unknown>> {
    const idea = await this.pm.getIdea(ideaId);
    if (access !== 'all' && !isPinnedRuleChange(idea)) {
      refuse('you can read pinned-rule changes only');
    }
    const e = idea.evidence ?? {};
    const settings = (await this.ownerSettings.get()) as unknown as Record<
      string,
      unknown
    >;
    const scope = await this.holds.languagesFor(idea as any);
    const rung = (r: any) =>
      r
        ? {
            status: r.status ?? null,
            passed: r.passed ?? null,
            reason: r.reason ?? null,
            at: r.at ?? r.startedAt ?? r.checkedAt ?? null,
          }
        : null;
    return {
      id: idea.id,
      title: idea.text,
      status: idea.status,
      kind: changeKindOf(idea.change) ?? idea.change?.ideaKind ?? null,
      route: idea.change?.route ?? null,
      confidence: e.confidence ?? null,
      always_asks_because: alwaysAskReasons(idea, settings),
      hypothesis: e.hypothesis ?? null,
      expected_effect: e.expectedEffect ?? null,
      evidence: e.evidence ?? e.problem?.summary ?? null,
      metrics: e.metrics ?? [],
      comment_count: (e.commentIds ?? []).length,
      languages: scope.languages,
      held_languages: scope.heldLanguages,
      quick_test: rung(e.screen),
      pass_test: rung(e.gate),
      side_by_side_trial: rung(e.trial),
      learner_try_out: rung(e.canary),
      handoff: e.handoff
        ? {
            kind: e.handoff.kind ?? null,
            status: e.handoff.status ?? null,
            started_on_its_own: !!e.handoff.startedOnItsOwn,
          }
        : null,
      stopped: e.stopped ?? null,
      undone: e.undone ?? null,
      forecast: e.forecast ?? null,
      rejected_because: e.rejection?.reason ?? null,
      conversation: (e.conversation ?? []).slice(-10),
    };
  }

  /** `session_read`: one session's run summary, never its transcript or a learner's words. */
  async sessionRead(runId: string): Promise<Record<string, unknown>> {
    const [run] = await this.dataSource.query(
      `SELECT id, "scenarioSessionId", mode, status, language, "recipeKey", "releaseVersion",
              "hasRiskCue", "learnerDistress", "revisionRounds", "estimatedCostUsd",
              "evaluatorOverall", workspace->'judge'->'overall' AS judge_overall,
              workspace->'judge'->'hardFails' AS judge_hard_fails, "createdAt"
         FROM debrief_runs WHERE id = $1`,
      [runId],
    );
    if (!run) refuse('there is no such session run');
    const flags: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT section, reason, status, answer FROM debrief_run_feedback
        WHERE "runId" = $1 AND kind = 'flag' AND status <> 'withdrawn'`,
      [runId],
    );
    const [helpful] = await this.dataSource.query(
      `SELECT bool_or(helpful) AS helpful FROM debrief_run_feedback
        WHERE "runId" = $1 AND kind = 'helpful'`,
      [runId],
    );
    return {
      run_id: run.id,
      session_id: run.scenarioSessionId,
      mode: run.mode,
      status: run.status,
      language: run.language,
      recipe: run.recipeKey,
      release: run.releaseVersion,
      risk_cue: run.hasRiskCue,
      learner_distress: run.learnerDistress,
      revision_rounds: run.revisionRounds,
      cost_usd:
        run.estimatedCostUsd != null ? Number(run.estimatedCostUsd) : null,
      quality_score:
        run.judge_overall != null ? Number(run.judge_overall) : null,
      hard_fails: run.judge_hard_fails ?? [],
      helpful: helpful?.helpful ?? null,
      flags: flags.map((f) => ({
        card: f.section,
        reason: f.reason,
        status: f.status,
        answer: f.answer ? { action: f.answer.action, at: f.answer.at } : null,
      })),
      at: new Date(run.createdAt).toISOString(),
    };
  }

  /** May this person carry out this action? If not: say who can, and tell them. */
  private async requirePermission(
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    idea: Record<string, any>,
    action: DebriefAction,
    what: string,
  ): Promise<void> {
    if (viewer.can[action]) return;
    const who = whoDecides(action);
    const alert = {
      title: `Debriefs: ${what} needs your decision`,
      body: `${person.authorName ?? 'Someone'} asked the PM agent to ${what} ${changeName(idea)}. Only ${who} can.`,
      data: { ideaId: idea.id, url: `/debriefs?change=${idea.id}` },
      excludeUserId: person.authorUserId ?? undefined,
    };
    if (action === 'approvePinnedRule') {
      await this.notifier?.pinnedRuleDeciders(alert);
    } else {
      await this.notifier?.owner(alert);
    }
    const err = new Refused(
      `Only ${who} can ${what} this; I've asked them.`,
    ) as Refused & { recorded?: boolean };
    await this.record(person, {
      tool: 'permission',
      ideaId: idea.id,
      label: `Asked ${who} to ${what} ${changeName(idea)}`,
      status: 'failed',
    });
    err.recorded = true;
    throw err;
  }

  /** Approve or turn down: never at once. A plan the person must say yes to. */
  private async planDecision(
    tool: 'change_approve' | 'change_turn_down',
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    b: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    const idea = await this.pm.getIdea(this.ideaId(b));
    if (conversationAccess(viewer.can) !== 'all' && !isPinnedRuleChange(idea)) {
      refuse('the clinical advisor decides pinned-rule changes only');
    }
    if (!['proposed', 'approved'].includes(idea.status)) {
      refuse(
        `${changeName(idea)} is ${idea.status}; there is nothing to decide`,
      );
    }
    const what = tool === 'change_approve' ? 'approve' : 'turn down';
    await this.requirePermission(
      person,
      viewer,
      idea,
      requiredAction(idea, true),
      what,
    );
    const reason = String(b.reason ?? '')
      .trim()
      .slice(0, 500);
    if (tool === 'change_turn_down' && !reason) {
      refuse('say why it is turned down; the PM agent reads the reason');
    }
    const label =
      tool === 'change_approve'
        ? `Approve ${changeName(idea)}`
        : `Turn down ${changeName(idea)}`;
    return this.makePlan(person, tool, idea, { reason }, label, b.plan);
  }

  private async makePlan(
    person: DebriefPmMessage,
    tool: string,
    idea: Record<string, any>,
    args: Record<string, unknown>,
    label: string,
    text: unknown,
  ): Promise<Record<string, unknown>> {
    const plan: PmPlan = {
      id: randomUUID(),
      tool,
      ideaId: idea.id,
      args,
      text: (typeof text === 'string' && text.trim()
        ? text.trim()
        : `${label}.`
      ).slice(0, 600),
      label,
      askedUserId: person.authorUserId ?? null,
      at: new Date().toISOString(),
      usedAt: null,
    };
    // Kept on the person's message until the reply is stored with it.
    await this.dataSource.query(
      `UPDATE debrief_pm_messages SET plan = $2::jsonb WHERE id = $1`,
      [person.id, JSON.stringify(plan)],
    );
    await this.record(person, {
      tool,
      ideaId: idea.id,
      label: `Waiting for your yes: ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
      status: 'awaiting_yes',
      planId: plan.id,
    });
    return {
      status: 'awaiting_yes',
      plan_id: plan.id,
      plan: plan.text,
      say: 'Repeat the plan back exactly and ask the person to reply yes. Do not call confirm_plan in this message.',
    };
  }

  /** `confirm_plan`: the person's message is a yes to the plan they were asked. */
  private async confirm(
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    planId: string,
  ): Promise<Record<string, unknown>> {
    const holder = await this.pendingPlan(person.createdAt);
    const plan = holder?.plan;
    if (!plan || plan.id !== planId) {
      refuse(
        'there is no plan waiting for a yes (it was used, replaced or is over a day old); ask again',
      );
    }
    if (plan!.askedUserId !== person.authorUserId) {
      refuse(
        'only the person who was asked can say yes to this plan; they can ask me again',
      );
    }
    if (!isExplicitYes(person.text)) {
      refuse(
        'the person did not say a clear yes; nothing was done. Ask them to reply yes to go ahead',
      );
    }
    const idea = await this.pm.getIdea(plan!.ideaId!);
    const tool = plan!.tool;
    const decision = tool === 'change_approve' || tool === 'change_turn_down';
    await this.requirePermission(
      person,
      viewer,
      idea,
      requiredAction(idea, decision),
      tool === 'change_approve'
        ? 'approve'
        : tool === 'change_turn_down'
          ? 'turn down'
          : 'retry',
    );
    // Used once, whatever happens next.
    await this.dataSource.query(
      `UPDATE debrief_pm_messages SET plan = jsonb_set(plan, '{usedAt}', to_jsonb(now()::text))
        WHERE id = $1`,
      [holder!.id],
    );
    const note = `From the PM agent conversation: “${person.text.slice(0, 200)}”`;
    let label: string;
    const userId = person.authorUserId!;
    if (tool === 'change_approve') {
      if (isPinnedRuleChange(idea)) {
        await this.pm.approvePinnedRule(idea.id, userId, note);
      } else {
        await this.pm.approve(idea.id, userId, note);
      }
      label = `Approved ${changeName(idea)}`;
    } else if (tool === 'change_turn_down') {
      const reason = String(plan!.args.reason ?? '') || note;
      if (isPinnedRuleChange(idea)) {
        await this.pm.rejectPinnedRule(idea.id, userId, reason);
      } else {
        await this.pm.reject(idea.id, userId, reason);
      }
      label = `Turned down ${changeName(idea)}`;
    } else if (tool === 'change_retry') {
      const out = await this.retryNow(
        idea,
        normaliseLanguages(plan!.args.languages),
        userId,
      );
      label = out.label;
    } else {
      refuse('this plan cannot be carried out');
      label = '';
    }
    await this.record(person, {
      tool,
      ideaId: idea.id,
      label,
      status: 'done',
      planId: plan!.id,
    });
    return { ok: true, done: label };
  }

  /** The actions that act at once (or wait for a yes, for an always-ask retry). */
  private async act(
    tool: PmConversationTool,
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    b: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    const by = person.authorUserId ?? null;
    if (tool === 'changes_pause') {
      if (!viewer.can.pmAgent)
        refuse('only the Ally team or the owner can pause changes');
      const kind = String(b.kind ?? '');
      if (!(PAUSABLE_KINDS as readonly string[]).includes(kind)) {
        refuse(`only ${PAUSABLE_KINDS.join(', ')} changes can be paused`);
      }
      const until = new Date(String(b.until ?? ''));
      await this.holds.pause(kind, until, by, String(b.reason ?? '') || null);
      const label = `Paused ${kind === 'code' ? 'Builder and Bug Hunter hand-offs' : `${kind} changes`} until ${until.toISOString().slice(0, 10)}`;
      await this.record(person, { tool, ideaId: null, label, status: 'done' });
      return { ok: true, done: label };
    }
    const idea = await this.pm.getIdea(this.ideaId(b));
    await this.requirePermission(
      person,
      viewer,
      idea,
      requiredAction(idea, false),
      verb(tool),
    );
    const languages = normaliseLanguages(b.languages);
    const reason =
      String(b.reason ?? '')
        .trim()
        .slice(0, 500) || null;
    let label: string;
    switch (tool) {
      case 'change_stop':
        label = await this.stop(idea, by, reason);
        break;
      case 'change_undo':
        label = await this.undo(idea, languages, by, reason);
        break;
      case 'change_hold_language': {
        const language = normaliseLanguages([b.language])?.[0];
        if (!language) refuse('name one language code, for example hi');
        label = await this.holdLanguage(idea, language!, by, reason);
        break;
      }
      case 'change_retry': {
        const settings = (await this.ownerSettings.get()) as unknown as Record<
          string,
          unknown
        >;
        if (alwaysAskReasons(idea, settings).length) {
          return this.makePlan(
            person,
            tool,
            idea,
            { languages },
            `Try ${changeName(idea)} again${languages ? ` for ${languages.join(', ')}` : ''}`,
            b.plan,
          );
        }
        label = (await this.retryNow(idea, languages, by)).label;
        break;
      }
      default:
        refuse(`${tool} is not an action`);
        label = '';
    }
    await this.record(person, { tool, ideaId: idea.id, label, status: 'done' });
    return { ok: true, done: label };
  }

  // --- what the actions do ---------------------------------------------------------------

  /** Stop a change being tried: its checks, trial or learner try-out. */
  async stop(
    idea: Record<string, any>,
    by: number | null,
    reason: string | null,
  ): Promise<string> {
    const e = idea.evidence ?? {};
    const running = (r: any) => r && ['running', 'waiting'].includes(r.status);
    const rungs = (['screen', 'gate', 'trial', 'canary'] as const).filter((k) =>
      running(e[k]),
    );
    if (!rungs.length || idea.status !== 'proposed') {
      refuse(`${changeName(idea)} is not being tried`);
    }
    if (rungs.includes('canary')) {
      await this.releases
        .stopCanary(
          DEBRIEF_AGENT_KEY,
          by,
          false,
          reason ?? 'Stopped from the PM agent conversation',
        )
        .catch((err) => {
          // Already ended by its watcher: the evidence below still records the stop.
          this.logger.warn(
            `[pm-conversation] stop canary: ${(err as Error).message}`,
          );
        });
    }
    const at = new Date().toISOString();
    for (const k of rungs) {
      await this.pm.writeEvidence(idea.id, k, {
        ...e[k],
        status: 'stopped',
        stoppedAt: at,
      });
    }
    await this.pm.writeEvidence(idea.id, 'stopped', { at, by, reason, rungs });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'rejected', "decidedBy" = $2, "decidedAt" = now(),
              "updatedAt" = now() WHERE id = $1`,
      [idea.id, by],
    );
    return `Stopped trying ${changeName(idea)}`;
  }

  /** The release a change replaced when it went live (what undo goes back to). */
  private async releaseBefore(releaseId: string): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT detail->>'fromReleaseId' AS id FROM agent_release_audit
        WHERE "agentKey" = $1 AND "releaseId" = $2 AND action = $3
        ORDER BY "createdAt" DESC LIMIT 1`,
      [DEBRIEF_AGENT_KEY, releaseId, AgentReleaseAuditAction.PROMOTED],
    );
    return row?.id ?? null;
  }

  /** Undo a live change: for everyone, or only for some languages (A9). */
  async undo(
    idea: Record<string, any>,
    languages: string[] | null,
    by: number | null,
    reason: string | null,
  ): Promise<string> {
    const scope = await this.holds.languagesFor(idea as any);
    // A change live only for some languages: undoing lifts those pins.
    if (scope.languages && idea.status === 'active') {
      const lifted = await this.holds.lift(
        idea.id,
        languages ?? scope.languages,
        by,
      );
      if (!lifted.length)
        refuse(`${changeName(idea)} is not live for those languages`);
      await this.pm.writeEvidence(idea.id, 'undone', {
        at: new Date().toISOString(),
        by,
        reason,
        languages: lifted,
      });
      if (!languages || lifted.length === scope.languages.length) {
        await this.retire(idea.id);
      }
      return `Undid ${changeName(idea)} for ${lifted.join(', ')}`;
    }
    if (idea.status !== 'active' || !idea.releaseId) {
      refuse(`${changeName(idea)} is not live`);
    }
    const before = await this.releaseBefore(idea.releaseId);
    if (!before) refuse('there is no release before this change to go back to');
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
    if (ga?.id !== idea.releaseId) {
      refuse(
        `later changes went live on top of ${changeName(idea)}; going back would undo them too. Undo the later ones first`,
      );
    }
    const at = new Date().toISOString();
    if (languages) {
      for (const language of languages) {
        await this.holds.pin({
          language,
          releaseId: before!,
          ideaId: idea.id,
          reason: 'undone',
          by,
          note: reason,
        });
      }
      await this.pm.writeEvidence(idea.id, 'undone', {
        at,
        by,
        reason,
        languages,
      });
      return `Undid ${changeName(idea)} for ${languages.join(', ')}`;
    }
    await this.releases.makeGa(
      before!,
      by,
      AgentReleaseAuditAction.ROLLED_BACK,
      reason ?? `Undone from the PM agent conversation: ${idea.text}`,
    );
    await this.holds.lift(idea.id, null, by);
    await this.pm.writeEvidence(idea.id, 'undone', {
      at,
      by,
      reason,
      languages: null,
    });
    await this.retire(idea.id);
    await this.notifier?.owner({
      title: 'Debriefs: a change was undone',
      body: `${changeName(idea)} was undone from the PM agent conversation${reason ? `: ${reason}` : ''}.`,
      data: { ideaId: idea.id },
      excludeUserId: by ?? undefined,
    });
    return `Undid ${changeName(idea)} for everyone`;
  }

  private async retire(ideaId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'retired', "updatedAt" = now() WHERE id = $1`,
      [ideaId],
    );
  }

  /**
   * Keep one language away from a change (A9): on the release before it when
   * it is live; on the release in force while it is being tried (that
   * language's sessions then never join its try-out).
   */
  async holdLanguage(
    idea: Record<string, any>,
    language: string,
    by: number | null,
    reason: string | null,
  ): Promise<string> {
    let releaseId: string | null = null;
    if (idea.status === 'active' && idea.releaseId) {
      releaseId = await this.releaseBefore(idea.releaseId);
    } else if (idea.status === 'proposed') {
      releaseId = (await this.releases.getGa(DEBRIEF_AGENT_KEY))?.id ?? null;
    }
    if (!releaseId) {
      refuse(
        `${changeName(idea)} is neither live nor being tried, so there is nothing to hold`,
      );
    }
    await this.holds.pin({
      language,
      releaseId: releaseId!,
      ideaId: idea.id,
      reason: 'held',
      by,
      note: reason,
    });
    return `Held ${changeName(idea)} back for ${language}`;
  }

  /**
   * Try a change again (A9): lift the languages it was held or undone for
   * when it is still live; otherwise start its ladder again from the quick
   * check, for every language or only those named.
   */
  async retryNow(
    idea: Record<string, any>,
    languages: string[] | null,
    by: number | null,
  ): Promise<{ label: string }> {
    const scope = await this.holds.languagesFor(idea as any);
    if (idea.status === 'active' && scope.heldLanguages.length) {
      const lifted = await this.holds.lift(idea.id, languages, by);
      if (!lifted.length)
        refuse(`${changeName(idea)} is not held for those languages`);
      await this.pm.writeEvidence(idea.id, 'retried', {
        at: new Date().toISOString(),
        by,
        languages: lifted,
      });
      return {
        label: `${changeName(idea)} is back on for ${lifted.join(', ')}`,
      };
    }
    const e = idea.evidence ?? {};
    if (
      !e.stopped &&
      !e.undone &&
      !['rejected', 'retired'].includes(idea.status)
    ) {
      refuse(
        `${changeName(idea)} was not stopped or undone, so there is nothing to retry`,
      );
    }
    const kind = idea.change?.ideaKind;
    if (kind !== 'prompt_edit' && kind !== 'setting') {
      refuse(
        'only prompt and setting changes can be tried again here; ask for a new change instead',
      );
    }
    const change = { ...idea.change, languages: languages ?? null };
    await this.dataSource.query(
      `UPDATE agent_lessons
          SET status = 'proposed', "releaseId" = NULL, change = $2::jsonb,
              evidence = (evidence - 'screen' - 'gate' - 'trial' - 'canary' - 'stopped' - 'undone' - 'rejection'),
              "decidedBy" = NULL, "decidedAt" = NULL, "updatedAt" = now()
        WHERE id = $1`,
      [idea.id, JSON.stringify(change)],
    );
    await this.pm.writeEvidence(idea.id, 'retried', {
      at: new Date().toISOString(),
      by,
      languages,
      before: {
        stopped: e.stopped ?? null,
        undone: e.undone ?? null,
        rejection: e.rejection ?? null,
      },
    });
    await this.pm.screen(idea.id);
    return {
      label: `Started trying ${changeName(idea)} again${languages ? ` for ${languages.join(', ')}` : ''}`,
    };
  }
}

function verb(tool: string): string {
  switch (tool) {
    case 'change_stop':
      return 'stop';
    case 'change_undo':
      return 'undo';
    case 'change_retry':
      return 'retry';
    case 'change_hold_language':
      return 'hold a language back for';
    case 'changes_pause':
      return 'pause';
    case 'change_approve':
      return 'approve';
    case 'change_turn_down':
      return 'turn down';
    default:
      return 'do that to';
  }
}
