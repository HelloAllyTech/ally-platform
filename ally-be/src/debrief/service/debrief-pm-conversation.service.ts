import { pmAgentPrompts } from './debrief-pm-agent-run.service';
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
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import { DEBRIEF_MODELS } from '../constants/debrief-release.constants';
import { DEBRIEF_AGENT_KEY } from '../../common/constants/debrief-agent.constants';
import {
  DebriefPmMessage,
  PmAbout,
  PmPlan,
  PmPlanAction,
  PmTurnAction,
} from '../entity/debrief-pm-message.entity';
import { modelPrices } from '../util/debrief-budget.util';
import {
  DebriefAction,
  DebriefViewer,
} from '../util/debrief-console-roles.util';
import { changeKindOf } from '../util/debrief-console-view.util';
import { alwaysAsk } from '../util/debrief-always-ask.util';
import { DebriefChangesService } from './debrief-changes.service';
import {
  changeName,
  isExplicitYes,
  isPinnedRuleChange,
  MAX_MESSAGE_CHARS,
  PmMessageView,
  pmReplyUnmatched,
  requiredAction,
  textLeaves,
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
  PmApprovedAction,
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
/**
 * ally-ai's checkpoint thread for the console's one shared conversation.
 */
export const PM_CONVERSATION_THREAD = 'debrief-pm-conversation';
/** A pause older than this lapses: the next message turns it down. */
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Shown instead of a reply that quotes, or presents as a change's wording or
 * a rule's text, anything the turn's tools did not return verbatim.
 */
export const QUOTE_CHECK_REPLY =
  "I don't have that text, so I can't quote it. Ask me to read the change first.";
/** The tools that pause for a person's yes (ally-ai `INTERRUPT_ON`). */
const PAUSING_TOOLS = ['change_approve', 'change_turn_down', 'change_retry'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every tool a full conversation turn is given. */
export const CONVERSATION_TURN_TOOLS: readonly PmAgentGatewayTool[] = [
  'comments_read',
  'reporting_query',
  'metrics_view',
  'guidance_report',
  'idea_propose',
  'release_draft',
  'ladder_start_quick_test',
  'change_read',
  'prompt_read',
  'session_read',
  'change_approve',
  'change_turn_down',
  'change_stop',
  'change_undo',
  'change_retry',
  'change_hold_language',
  'changes_pause',
];

/** A refusal the agent reads (200 `{ refused }`) and relays in plain words. */
class Refused extends Error {}
const refuse = (reason: string): never => {
  throw new Refused(reason);
};

/** The action(s) ally-ai's turn paused on (a LangGraph interrupt). */
interface PmPending {
  interrupt_id: string;
  actions: Array<{ tool: string; args: Record<string, any>; plan: string }>;
}

/** ally-be's decision on a paused turn, for ally-ai to resume with. */
interface PmResume {
  interrupt_id: string;
  decision: 'approve' | 'reject';
  message?: string | null;
}

interface PmConversationResponse {
  status: 'finished' | 'budget_spent' | 'failed';
  reply?: string | null;
  pending?: PmPending | null;
  /** Every string the turn's tools returned (the quote check's sources). */
  tool_texts?: string[];
  estimated_cost_usd?: number;
  model?: string | null;
  steps?: Array<Record<string, unknown>>;
  refusals?: Array<{ tool: string; reason: string }>;
  error?: string | null;
}

/**
 * The Debrief console's one PM agent conversation (V2_AUTONOMY C1–C3): one
 * shared thread in `debrief_pm_messages`, the record the console reads. A
 * person's message runs the PM agent in ally-ai (`POST
 * /api/v1/pm-agent/conversation`), a Deep Agent on a checkpoint thread
 * (`PM_CONVERSATION_THREAD`), with only the new message,
 * what the person is looking at and its evidence, and a token for the
 * conversation's tools. The agent replies and acts only through those tools,
 * served here; each action is recorded on the person's message, on the change
 * (`evidence.conversation`) and in the audit with the person's words.
 *
 * Permissions are today's (debrief-console-roles.util.ts): the Ally team and
 * the owner (`pmAgent`) read and post; nobody else. Approving or turning down a change, and retrying one
 * that always asks, pause ally-ai's turn (LangGraph human-in-the-loop); the
 * pause is kept on the reply (`plan`). The thread's next message resolves it:
 * the same person's explicit yes, with the permission — a budget increase the
 * owner's, everything else the Ally team's or the owner's — resumes with approve
 * and a token signed for them (`approved`); anything else resumes with reject
 * and their words, and the agent answers them.
 *
 * Every reply is checked before it is shown: what it quotes, or presents as a
 * change's wording or a rule's text, must be in what the turn's tools returned
 * (`pmReplyUnmatched`); a reply that fails is kept in the audit only.
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
    /** The console's Undo now and Stop now (the backend core). */
    private readonly changes: DebriefChangesService,
    @Optional() private readonly notifier?: DebriefNotifier,
  ) {}

  // --- the thread ---------------------------------------------------------------------

  /**
   * `GET pm-agent/conversation?before&limit&about`: newest page, oldest first.
   * `about` (a change id) narrows to the messages about that change.
   */
  async list(
    viewer: DebriefViewer,
    opts: { before?: string; limit?: number; about?: string },
  ): Promise<{ messages: PmMessageView[]; more: boolean }> {
    if (!viewer.can.pmAgent) {
      throw new ForbiddenException(
        'You cannot read the Debrief PM agent conversation',
      );
    }
    const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
    const qb = this.messages.createQueryBuilder('m');
    if (opts.about) {
      if (!UUID.test(opts.about)) {
        throw new BadRequestException('about must be a change id');
      }
      qb.andWhere(`m.about->>'id' = :about`, { about: opts.about });
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
    if (!viewer.can.pmAgent) {
      throw new ForbiddenException('You cannot talk to the Debrief PM agent');
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
    const reply = await this.answer(person, viewer, about);
    return { messages: [toPmMessage(person), toPmMessage(reply)] };
  }

  /**
   * The agent message whose pause the thread is still waiting on: at most one
   * per thread, since every message in the thread resolves it.
   */
  private async pausedOn(threadId: string): Promise<DebriefPmMessage | null> {
    return this.messages
      .createQueryBuilder('m')
      .where(`m.who = 'agent'`)
      .andWhere(`m.plan->>'threadId' = :threadId`, { threadId })
      .andWhere(`m.plan->>'usedAt' IS NULL`)
      .orderBy('m."createdAt"', 'DESC')
      .getOne();
  }

  /**
   * The person's message answers the pause: approve only for the asked
   * person's explicit yes, within a day, with the permission for every action;
   * otherwise reject, with words the agent reads. Resolved once, either way.
   */
  private async resolve(
    paused: DebriefPmMessage,
    person: DebriefPmMessage,
    viewer: DebriefViewer,
  ): Promise<{ resume: PmResume; approved: PmApprovedAction[] }> {
    const plan = paused.plan!;
    const who = person.authorName ?? 'The person';
    const words = `“${person.text.slice(0, 500)}”`;
    let reason: string | null = null;
    if (Date.now() - new Date(plan.at).getTime() > PLAN_TTL_MS) {
      reason = `The plan waited over a day, so it lapsed and nothing was done. ${who} wrote next: ${words}`;
    } else if (plan.askedUserId !== person.authorUserId) {
      reason = `${who} wrote next, and only the person who was asked can say yes to the plan, so nothing was done. ${who} wrote: ${words}`;
    } else if (!isExplicitYes(person.text)) {
      reason = `${who} did not say yes, so nothing was done. They wrote: ${words}`;
    } else {
      for (const a of plan.actions) {
        if (!a.ideaId) continue;
        try {
          const idea = await this.pm.getIdea(a.ideaId);
          await this.requirePermission(
            person,
            viewer,
            idea,
            requiredAction(idea),
            verb(a.tool),
          );
        } catch (e) {
          if (!(e instanceof Refused) && !(e instanceof HttpException)) throw e;
          reason = `${(e as Error).message} Nothing was done.`;
          break;
        }
      }
    }
    const decision = reason ? 'reject' : 'approve';
    await this.dataSource.query(
      `UPDATE debrief_pm_messages
          SET plan = plan || jsonb_build_object('usedAt', now()::text, 'decision', $2::text)
        WHERE id = $1`,
      [paused.id, decision],
    );
    if (reason) {
      return {
        resume: { interrupt_id: plan.id, decision: 'reject', message: reason },
        approved: [],
      };
    }
    return {
      resume: { interrupt_id: plan.id, decision: 'approve' },
      approved: plan.actions.map((a) => ({ tool: a.tool, ideaId: a.ideaId })),
    };
  }

  /**
   * A pause the person could say yes to: each action is one that pauses, on a
   * change they may decide, with what it needs. Returns why not (recorded as a
   * failed action, the decider told when it is a permission) or the actions.
   */
  private async checkPause(
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    pending: PmPending,
  ): Promise<{ reason: string } | { actions: PmPlanAction[] }> {
    const actions: PmPlanAction[] = [];
    for (const a of pending.actions ?? []) {
      const b = a.args ?? {};
      try {
        if (!PAUSING_TOOLS.includes(a.tool)) {
          refuse(`${a.tool} does not wait for a yes`);
        }
        const idea = await this.pm.getIdea(this.ideaId(b));
        const decision = a.tool !== 'change_retry';
        if (decision && !['proposed', 'approved'].includes(idea.status)) {
          refuse(
            `${changeName(idea)} is ${idea.status}; there is nothing to decide`,
          );
        }
        if (a.tool === 'change_turn_down' && !String(b.reason ?? '').trim()) {
          refuse(
            'say why it is turned down; the Debrief PM agent reads the reason',
          );
        }
        await this.requirePermission(
          person,
          viewer,
          idea,
          requiredAction(idea),
          verb(a.tool),
        );
        const languages = normaliseLanguages(b.languages);
        actions.push({
          tool: a.tool,
          ideaId: idea.id,
          args: {
            ...(b.reason ? { reason: String(b.reason).slice(0, 500) } : {}),
            ...(languages ? { languages } : {}),
          },
          label:
            a.tool === 'change_approve'
              ? `Approve ${changeName(idea)}`
              : a.tool === 'change_turn_down'
                ? `Turn down ${changeName(idea)}`
                : `Try ${changeName(idea)} again${languages ? ` for ${languages.join(', ')}` : ''}`,
        });
      } catch (e) {
        if (!(e instanceof Refused) && !(e instanceof HttpException)) throw e;
        const reason = (e as Error).message;
        if (!(e as { recorded?: boolean }).recorded) {
          await this.record(person, {
            tool: a.tool,
            ideaId: UUID.test(String(b.idea_id)) ? String(b.idea_id) : null,
            label: `Could not ${verb(a.tool)}: ${reason}`.slice(0, 300),
            status: 'failed',
          });
        }
        return { reason };
      }
    }
    return { actions };
  }

  /** Changes whose retry always asks a person: ally-ai pauses a retry of these. */
  private async alwaysAskIds(): Promise<string[]> {
    try {
      const settings = (await this.ownerSettings.get()) as unknown as Record<
        string,
        unknown
      >;
      const rows: Array<Record<string, any>> = await this.dataSource.query(
        `SELECT id, change, evidence FROM agent_lessons WHERE "agentKey" = $1`,
        [DEBRIEF_AGENT_KEY],
      );
      return rows
        .filter((r) => alwaysAsk(r, settings as any))
        .map((r) => r.id)
        .slice(0, 2000);
    } catch {
      // Without the list a retry still cannot skip a person: the gateway
      // refuses an always-ask retry that carries no yes.
      return [];
    }
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
    viewer: DebriefViewer,
    about: PmAbout | null,
  ): Promise<DebriefPmMessage> {
    const threadId = PM_CONVERSATION_THREAD;
    const budgetUsd = await this.turnBudget();
    const evidence = await this.aboutEvidence(about);
    let res: PmConversationResponse;
    let pause: PmPlan | null = null;
    if (budgetUsd <= 0) {
      res = {
        status: 'budget_spent',
        reply:
          "This month's learning budget is spent, so I can't look into this now. The owner can raise it in Settings › Budgets.",
      };
    } else {
      const tools = CONVERSATION_TURN_TOOLS;
      const model = DEBRIEF_MODELS.pmAgent;
      const backup = DEBRIEF_MODELS.pmAgentBackup;
      try {
        const paused = await this.pausedOn(threadId);
        const resolved = paused
          ? await this.resolve(paused, person, viewer)
          : null;
        const prompts = await this.prompts();
        const body = {
          turn_id: person.id,
          thread_id: threadId,
          model,
          backup_model: backup,
          prices: modelPrices([model, backup]),
          budget_usd: budgetUsd,
          message: person.text,
          author: person.authorName ?? null,
          about: evidence,
          always_ask_idea_ids: await this.alwaysAskIds(),
          tools: [...tools],
          gateway_url: this.tokens.gatewayUrl(),
          ...(prompts ? { prompts } : {}),
        };
        // The gateway acts as the person who wrote this message; a resumed
        // approval carries what they said yes to.
        const send = (resume: PmResume | null, approved: PmApprovedAction[]) =>
          this.call({
            ...body,
            resume,
            agent_token: this.tokens.signAgent(
              person.id,
              tools,
              15 * 60,
              approved,
            ),
          });
        res = await send(resolved?.resume ?? null, resolved?.approved ?? []);
        // A pause this person could never say yes to is turned down at once,
        // so the reply already says why (who decides, what is missing).
        let check = res.pending
          ? await this.checkPause(person, viewer, res.pending)
          : null;
        if (check && 'reason' in check && res.pending) {
          const again = await send(
            {
              interrupt_id: res.pending.interrupt_id,
              decision: 'reject',
              message: `${check.reason} Nothing was done.`,
            },
            [],
          );
          res = mergeTurns(res, again);
          check = res.pending
            ? await this.checkPause(person, viewer, res.pending)
            : null;
        }
        if (res.pending && check && 'actions' in check) {
          pause = {
            id: res.pending.interrupt_id,
            threadId,
            actions: check.actions,
            text: res.pending.actions
              .map((a) => a.plan)
              .filter(Boolean)
              .join(' ')
              .slice(0, 600),
            label: check.actions.map((a) => a.label).join('; '),
            askedUserId: person.authorUserId ?? null,
            at: new Date().toISOString(),
            usedAt: null,
          };
        }
        // A pause left unkept is cancelled by the thread's next message.
      } catch (e) {
        res = {
          status: 'failed',
          reply: "I couldn't answer just now. Please try again in a minute.",
          error: (e as Error).message.slice(0, 300),
        };
      }
    }
    // The quote check: nothing quoted or presented as wording that the turn's
    // tools (or the evidence and the person's own words) did not return.
    let text = (res.reply ?? '').trim();
    const unmatched =
      res.status === 'finished'
        ? pmReplyUnmatched([text, pause?.text ?? ''].join('\n'), [
            ...(res.tool_texts ?? []),
            ...textLeaves(evidence),
            person.text,
          ])
        : [];
    const withheld = unmatched.length ? text : null;
    if (withheld) {
      text = QUOTE_CHECK_REPLY;
      pause = null;
    }
    for (const a of pause?.actions ?? []) {
      await this.record(person, {
        tool: a.tool,
        ideaId: a.ideaId,
        label: `Waiting for your yes: ${a.label.charAt(0).toLowerCase()}${a.label.slice(1)}`,
        status: 'awaiting_yes',
        planId: pause!.id,
      });
    }
    await this.recordProposals(person);
    const fresh = await this.messages.findOne({ where: { id: person.id } });
    const actions = (fresh?.actions ?? []) as PmTurnAction[];
    // The action the reply shows: the turn's last one (a pause waiting for a
    // yes, or what was done or refused), from the gateway's record.
    const last = actions[actions.length - 1] ?? null;
    const reply = await this.messages.save(
      this.messages.create({
        who: 'agent',
        text:
          text.slice(0, MAX_MESSAGE_CHARS) ||
          "I couldn't answer just now. Please try again in a minute.",
        about,
        action: last ? { label: last.label, status: last.status } : null,
        actions: [],
        plan: pause,
        replyTo: person.id,
        status: res.status,
        model: res.model ?? null,
        costUsd:
          res.estimated_cost_usd != null
            ? String(res.estimated_cost_usd)
            : null,
      }),
    );
    if (withheld) {
      // Kept for the Ally team, never shown in the conversation.
      await this.pm.audit('blocked', null, person.authorUserId ?? null, {
        step: 'conversation_quote_check',
        messageId: person.id,
        replyId: reply.id,
        unmatched: unmatched.map((u) => u.slice(0, 300)),
        withheldReply: withheld.slice(0, MAX_MESSAGE_CHARS),
      });
    }
    await this.pm.audit('pipeline_step', null, person.authorUserId ?? null, {
      step: 'conversation_turn',
      messageId: person.id,
      replyId: reply.id,
      threadId,
      status: res.status,
      paused: pause ? pause.id : null,
      quoteCheck: withheld ? 'withheld' : 'passed',
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
    let overrides: Record<string, unknown> | null = null;
    try {
      const { AiService } = await import('../../ai/service/ai.service');
      const ai = this.moduleRef.get(AiService, { strict: false });
      overrides = await ai.getPromptOverrides([PM_CONVERSATION_PROMPT_CODE]);
    } catch {
      // ally-ai falls back to its default instructions.
    }
    // Its subagents and skills: the same live texts as the weekly run.
    const own = await pmAgentPrompts({
      promptText: async (code: string) => {
        const [row] = await this.dataSource.query(
          `SELECT pv.prompt FROM prompts p
             JOIN prompts_versions pv
               ON pv."promptId" = p.id AND pv.version = p."currentVersion"
            WHERE p."promptCode" = $1
            LIMIT 1`,
          [code],
        );
        return row?.prompt ? String(row.prompt) : null;
      },
    }).catch(() => ({}));
    return overrides || Object.keys(own).length
      ? { ...(overrides ?? {}), ...own }
      : null;
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
    if (!person) {
      // A weekly run's token (its reviewer subagent): read one change, as the
      // Ally team would; every other conversation tool needs a person's turn.
      if (tool === 'change_read') {
        try {
          return await this.changeRead(this.ideaId(b));
        } catch (e) {
          if (e instanceof Refused) return { refused: e.message };
          if (e instanceof HttpException && e.getStatus() < 500) {
            return { refused: e.message };
          }
          throw e;
        }
      }
      return { refused: 'this conversation turn is not known' };
    }
    try {
      const viewer = await this.view.viewer(person.authorUserId ?? -1);
      // The turn was allowed when the message was posted; the permission may have gone since.
      if (!viewer.can.pmAgent) {
        refuse('only the Ally team and the owner use the Debrief PM agent');
      }
      switch (tool) {
        case 'change_read':
          return await this.changeRead(this.ideaId(b));
        case 'session_read':
          return await this.sessionRead(this.uuid(b.run_id, 'run_id'));
        case 'change_approve':
        case 'change_turn_down':
          return await this.decide(tool, person, viewer, claims, b);
        default:
          return await this.act(tool, person, viewer, claims, b);
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
  async changeRead(ideaId: string): Promise<Record<string, unknown>> {
    const idea = await this.pm.getIdea(ideaId);
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
      always_asks_because:
        alwaysAsk(idea, settings as any)?.waitsBecause ?? null,
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
      undone: e.undo ?? e.undone ?? null,
      forecast: e.forecast ?? null,
      rejected_because: e.rejection?.reason ?? null,
      conversation: (e.conversation ?? []).slice(-10),
      // What actually changes, so the agent never describes it from memory:
      // the passage and its replacement.
      wording:
        typeof idea.change?.find === 'string' &&
        typeof idea.change?.replace === 'string'
          ? { before: idea.change.find, after: idea.change.replace }
          : null,
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
      body: `${person.authorName ?? 'Someone'} asked the Debrief PM agent to ${what} ${changeName(idea)}. Only ${who} can.`,
      data: { ideaId: idea.id, url: `/debriefs/pm-agent?change=${idea.id}` },
      excludeUserId: person.authorUserId ?? undefined,
    };
    await this.notifier?.owner(alert);
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

  /**
   * Approve or turn down: only on a resumed turn whose token carries the
   * person's yes to exactly this (`claims.approved`), and only if they hold
   * the permission now. The pause itself is ally-ai's (human-in-the-loop).
   */
  private async decide(
    tool: 'change_approve' | 'change_turn_down',
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    claims: DebriefAgentClaims,
    b: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    const idea = await this.pm.getIdea(this.ideaId(b));
    if (!approvedFor(claims, tool, idea.id)) {
      refuse(
        'approving or turning down a change waits for the person’s yes; nothing was done',
      );
    }
    if (isPinnedRuleChange(idea)) {
      refuse(
        'a pinned rule is changed in the Skills Store by a pinned editor, not here',
      );
    }
    if (!['proposed', 'approved'].includes(idea.status)) {
      refuse(
        `${changeName(idea)} is ${idea.status}; there is nothing to decide`,
      );
    }
    await this.requirePermission(
      person,
      viewer,
      idea,
      requiredAction(idea),
      verb(tool),
    );
    const note = `From the Debrief PM agent conversation: “${person.text.slice(0, 200)}”`;
    const userId = person.authorUserId!;
    let label: string;
    if (tool === 'change_approve') {
      await this.pm.approve(idea.id, userId, note);
      label = `Approved ${changeName(idea)}`;
    } else {
      const reason = String(b.reason ?? '')
        .trim()
        .slice(0, 500);
      if (!reason) {
        refuse(
          'say why it is turned down; the Debrief PM agent reads the reason',
        );
      }
      await this.pm.reject(idea.id, userId, reason);
      label = `Turned down ${changeName(idea)}`;
    }
    await this.record(person, {
      tool,
      ideaId: idea.id,
      label,
      status: 'done',
    });
    return { ok: true, done: label };
  }

  /** The actions that act at once (an always-ask retry only after a yes). */
  private async act(
    tool: PmConversationTool,
    person: DebriefPmMessage,
    viewer: DebriefViewer,
    claims: DebriefAgentClaims,
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
      requiredAction(idea),
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
        label = await this.stop(idea, by!, reason);
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
        // ally-ai pauses this retry for the person's yes; without one in the
        // token (a stale always-ask list) nothing is done.
        if (
          alwaysAsk(idea, settings as any) &&
          !approvedFor(claims, tool, idea.id)
        ) {
          refuse(
            `${changeName(idea)} always asks a person, so trying it again waits for their yes; nothing was done`,
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

  /**
   * Stop a change being tried: the console's Stop now
   * (DebriefChangesService.stop), as the person who asked.
   */
  async stop(
    idea: Record<string, any>,
    by: number,
    reason: string | null,
  ): Promise<string> {
    await this.changes.stop(idea.id, by, reason);
    return `Stopped trying ${changeName(idea)}`;
  }

  /** The release a change replaced when it went live (what undo goes back to). */
  private async releaseBefore(
    idea: Record<string, any>,
  ): Promise<string | null> {
    // The watch the core starts when a change goes live names it.
    const watched = idea.evidence?.watch?.previousReleaseId;
    if (watched) return watched;
    const releaseId = idea.releaseId ?? idea.evidence?.watch?.releaseId;
    if (!releaseId) return null;
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
    if (!languages) {
      // For everyone: the console's Undo now (DebriefChangesService.undo).
      await this.changes.undo(idea.id, by, reason);
      await this.holds.lift(idea.id, null, by);
      return `Undid ${changeName(idea)} for everyone`;
    }
    if (idea.status !== 'active') refuse(`${changeName(idea)} is not live`);
    const before = await this.releaseBefore(idea);
    if (!before) refuse('there is no release before this change to go back to');
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
    if (ga?.id !== (idea.releaseId ?? idea.evidence?.watch?.releaseId)) {
      refuse(
        `later changes went live on top of ${changeName(idea)}; going back for one language would undo them too. Undo the later ones first`,
      );
    }
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
      at: new Date().toISOString(),
      by,
      reason,
      languages,
    });
    return `Undid ${changeName(idea)} for ${languages.join(', ')}`;
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
    if (idea.status === 'active') {
      releaseId = await this.releaseBefore(idea);
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
      !e.undo &&
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
              evidence = (evidence - 'screen' - 'gate' - 'trial' - 'canary' - 'stopped' - 'undone' - 'undo' - 'watch' - 'ask' - 'approval' - 'rejection'),
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
        undone: e.undone ?? e.undo ?? null,
        rejection: e.rejection ?? null,
      },
    });
    await this.pm.screen(idea.id);
    return {
      label: `Started trying ${changeName(idea)} again${languages ? ` for ${languages.join(', ')}` : ''}`,
    };
  }
}

/** Two ally-ai calls of one turn as one: the later reply, both costs and records. */
function mergeTurns(
  first: PmConversationResponse,
  then: PmConversationResponse,
): PmConversationResponse {
  return {
    ...then,
    estimated_cost_usd:
      Math.round(
        ((first.estimated_cost_usd ?? 0) + (then.estimated_cost_usd ?? 0)) *
          10_000,
      ) / 10_000,
    tool_texts: [...(first.tool_texts ?? []), ...(then.tool_texts ?? [])],
    steps: [...(first.steps ?? []), ...(then.steps ?? [])],
    refusals: [...(first.refusals ?? []), ...(then.refusals ?? [])],
  };
}

/** Was this action said yes to by the person whose message this turn answers? */
function approvedFor(
  claims: DebriefAgentClaims,
  tool: string,
  ideaId: string,
): boolean {
  return (claims.approved ?? []).some(
    (a) => a.tool === tool && a.ideaId === ideaId,
  );
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
