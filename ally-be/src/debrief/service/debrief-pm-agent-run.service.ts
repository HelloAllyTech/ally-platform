import {
  ConflictException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { pmAgentAutonomy } from '../constants/debrief-owner-settings.constants';
import { DebriefAutonomyService } from './debrief-autonomy.service';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_MODELS,
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
  DEBRIEF_PROMPT_CODES,
  DebriefRecipeKey,
  PM_AGENT_EDITABLE_PROMPTS,
  PM_AGENT_SETTINGS,
} from '../constants/debrief-release.constants';
import { modelPrices } from '../util/debrief-budget.util';
import {
  PM_AGENT_GATEWAY_TOOLS,
  DebriefRunTokenService,
} from './debrief-run-token.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefFeedbackService } from './debrief-feedback.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefPmAgentToolsService } from './debrief-pm-agent-tools.service';
import { DebriefReportingService } from './debrief-reporting.service';
import { DebriefReviewService } from './debrief-review.service';
import { DebriefSettingsService } from './debrief-settings.service';
import { DebriefTestSetsService } from './debrief-test-sets.service';

/** A run is minutes; past this ally-be stops waiting (the token lives 2 h). */
export const PM_AGENT_RUN_TIMEOUT_MS = 45 * 60 * 1000;

/** `POST /api/v1/pm-agent/runs` (CONTRACT.md §7). */
export interface PmAgentRunResponse {
  status: 'finished' | 'budget_spent' | 'failed';
  report?: string | null;
  idea_ids?: string[];
  steps?: Array<Record<string, unknown>>;
  todos?: Array<Record<string, unknown>>;
  estimated_cost_usd?: number;
  model?: string | null;
  refusals?: Array<{ tool: string; reason: string }>;
  error?: string | null;
}

export interface PmAgentRunOutcome {
  report: string | null;
  ideas: string[];
  skipped?: string;
  status?: PmAgentRunResponse['status'];
  agentRunId?: string;
}

/**
 * Starts the PM agent (spec C1): ally-be packs the inputs, so every run starts
 * from the same evidence, signs an agent token listing the tools, calls the
 * Deep Agent in ally-ai and stores what comes back (the report and our own
 * step records) as the run's `curator_run` audit row. Weekly analysis and a
 * monthly deep review (v9 FR-50). Skips — and says why — when the agent is
 * off, the learning budget is spent, or there is nothing to read yet.
 */
@Injectable()
export class DebriefPmAgentRunService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefPmAgentRunService.name,
  );
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly tokens: DebriefRunTokenService,
    private readonly pm: DebriefPmAgentService,
    private readonly tools: DebriefPmAgentToolsService,
    private readonly reviews: DebriefReviewService,
    private readonly reporting: DebriefReportingService,
    private readonly learnerFeedback: DebriefFeedbackService,
    private readonly ownerSettings: DebriefSettingsService,
    private readonly context: DebriefContextRepository,
    private readonly testSets: DebriefTestSetsService,
    @Optional() private readonly autonomy?: DebriefAutonomyService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('weekly', 'debrief-pm-agent', async () => {
      await this.testSets.build();
      await this.run({ review: 'weekly' });
    });
    scheduledTaskRegistry.register(
      'monthly',
      'debrief-pm-agent-review',
      async () => {
        await this.run({ review: 'monthly' });
      },
    );
  }

  /** The Console's "Run now": starts a run and answers at once; the report lands when it finishes. */
  async start(actorUserId: number): Promise<PmAgentRunOutcome> {
    if (this.running)
      throw new ConflictException('the PM agent is already running');
    const pre = await this.precheck();
    if (pre) return { report: null, ideas: [], skipped: pre };
    void this.run({ review: 'weekly', actorUserId }).catch((e) =>
      this.logger.error(`[pm-agent] run failed: ${(e as Error).message}`),
    );
    return { report: null, ideas: [], status: undefined };
  }

  private async precheck(): Promise<string | null> {
    const settings = await this.ownerSettings.get();
    if (pmAgentAutonomy(settings) === 'off')
      return 'the PM agent is switched off';
    const spent = await this.pm.learningSpentThisMonth();
    if (spent >= (await this.pm.learningBudgetThisMonth())) {
      return 'learning budget spent';
    }
    return null;
  }

  async run(
    opts: { review?: 'weekly' | 'monthly'; actorUserId?: number | null } = {},
  ): Promise<PmAgentRunOutcome> {
    if (this.running)
      return { report: null, ideas: [], skipped: 'already running' };
    this.running = true;
    try {
      return await this.runOnce(opts);
    } finally {
      this.running = false;
    }
  }

  private async runOnce(opts: {
    review?: 'weekly' | 'monthly';
    actorUserId?: number | null;
  }): Promise<PmAgentRunOutcome> {
    const review = opts.review ?? 'weekly';
    const actor = opts.actorUserId ?? null;
    const skipped = await this.precheck();
    if (skipped) {
      await this.pm.audit('curator_run', null, actor, { review, skipped });
      return { report: null, ideas: [], skipped };
    }
    const agentRunId = randomUUID();
    const inputs = await this.packInputs(review);
    const counts = inputs.counts as Record<string, number>;
    if (!counts.runs && !counts.comments) {
      return {
        report: null,
        ideas: [],
        skipped: 'no runs or comments to read yet',
      };
    }
    const settings = await this.ownerSettings.get();
    const left =
      (await this.pm.learningBudgetThisMonth()) -
      (await this.pm.learningSpentThisMonth());
    const budgetUsd = Math.max(0, Math.min(settings.pmAgentRunCapUsd, left));
    const model = DEBRIEF_MODELS.pmAgent;
    const backup = DEBRIEF_MODELS.pmAgentBackup;
    const body = {
      agent_run_id: agentRunId,
      review,
      model,
      backup_model: backup,
      prices: modelPrices([model, backup]),
      budget_usd: Math.round(budgetUsd * 100) / 100,
      system_prompt: await this.context.promptText(
        DEBRIEF_PROMPT_CODES.pmAgent,
        null,
      ),
      inputs,
      tools: [...PM_AGENT_GATEWAY_TOOLS],
      agent_token: this.tokens.signAgent(agentRunId),
      gateway_url: this.tokens.gatewayUrl(),
    };
    let res: PmAgentRunResponse;
    try {
      res = await this.call(body);
    } catch (e) {
      res = { status: 'failed', error: (e as Error).message.slice(0, 300) };
    }
    await this.pm.audit('curator_run', null, actor, {
      agentRunId,
      review,
      status: res.status,
      report: res.report ?? null,
      error: res.error ?? null,
      model: res.model ?? null,
      steps: res.steps ?? [],
      todos: res.todos ?? [],
      ideaIds: res.idea_ids ?? [],
      refusals: res.refusals ?? [],
      costUsd: res.estimated_cost_usd ?? null,
      budgetUsd: body.budget_usd,
      inputs: counts,
      learningSpentUsd:
        Math.round((await this.pm.learningSpentThisMonth()) * 100) / 100,
    });
    return {
      report: res.report ?? null,
      ideas: res.idea_ids ?? [],
      status: res.status,
      agentRunId,
      ...(res.status === 'failed'
        ? { skipped: `the run failed: ${res.error}` }
        : {}),
    };
  }

  private async call(
    body: Record<string, unknown>,
  ): Promise<PmAgentRunResponse> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    try {
      const res = await axios.post(`${apiUrl}/api/v1/pm-agent/runs`, body, {
        headers: { 'x-api-key': outboundApiKey },
        timeout: PM_AGENT_RUN_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return res.data as PmAgentRunResponse;
    } catch (e) {
      const err = e as AxiosError<{ detail?: unknown }>;
      throw new Error(
        `pm agent ${err.response?.status ?? 'network'}: ${
          typeof err.response?.data?.detail === 'string'
            ? err.response.data.detail
            : err.message
        }`,
      );
    }
  }

  /**
   * Everything the agent reads at the start (spec C1): comments since the last
   * run plus every open one, metric failure points, judge and Evaluator
   * results (the reporting library), learner flags, the reporting catalogue,
   * the prompts and settings it may change, and what happened to its ideas.
   * Nothing here is a transcript; comment text is approved (D8).
   */
  async packInputs(
    review: 'weekly' | 'monthly',
  ): Promise<Record<string, unknown>> {
    const windowDays = review === 'monthly' ? 30 : 7;
    const [last] = await this.dataSource.query(
      `SELECT detail, "createdAt" FROM agent_lesson_audit
        WHERE "agentKey" = $1 AND action = 'curator_run' AND detail ? 'agentRunId'
        ORDER BY "createdAt" DESC LIMIT 1`,
      [DEBRIEF_AGENT_KEY],
    );
    const since: Date = last
      ? new Date(last.createdAt)
      : new Date(Date.now() - windowDays * 86_400_000);
    const fresh = await this.reviews.commentsForAgent({
      since: since.toISOString(),
      limit: 200,
    });
    const open = await this.reviews.commentsForAgent({
      status: 'open',
      limit: 200,
    });
    const seen = new Set(fresh.comments.map((c) => c.id));
    const openOnly = open.comments.filter((c) => !seen.has(c.id));
    const metrics = await this.tools.metricsView({
      weeks: review === 'monthly' ? 12 : 8,
    });
    const library = await this.reporting.library(windowDays);
    const [{ runs }] = await this.dataSource.query(
      `SELECT count(*)::int AS runs FROM debrief_runs
        WHERE mode IN ('shadow','live') AND status <> 'skipped'
          AND "createdAt" >= now() - make_interval(days => $1)`,
      [windowDays],
    );
    const { bundle } = await this.pm.gaBundle();
    const editable: Record<string, string> = {};
    const orchestratorOn = !!(
      bundle as { orchestrator?: { enabled?: boolean } }
    ).orchestrator?.enabled;
    for (const code of PM_AGENT_EDITABLE_PROMPTS) {
      if (!orchestratorOn && DEBRIEF_ORCHESTRATOR_PROMPT_CODES.includes(code))
        continue;
      const t = await this.context.promptText(
        code,
        bundle.prompts[code] ?? null,
      );
      if (t) editable[code] = t;
    }
    const settings = {
      current: {
        maxRevisionRounds:
          bundle.recipes[DebriefRecipeKey.STANDARD].maxRevisionRounds,
        ...Object.fromEntries(
          Object.keys(PM_AGENT_SETTINGS)
            .filter((k) => k !== 'maxRevisionRounds')
            .map((k) => [
              k,
              (bundle.settings as unknown as Record<string, unknown>)[k],
            ]),
        ),
      },
      allowed_ranges: PM_AGENT_SETTINGS,
    };
    const outcomes = (await this.pm.history(30)).map((h) => ({
      id: h.id,
      title: h.title,
      status: h.status,
      route: h.change?.route ?? null,
      kind: h.change?.ideaKind,
      quick_test: h.evidence?.screen
        ? {
            status: h.evidence.screen.status,
            lift: h.evidence.screen.lift ?? null,
            passed: h.evidence.screen.passed ?? null,
          }
        : null,
      gate: h.evidence?.gate?.passed ?? null,
      trial: h.evidence?.trial?.status ?? null,
      canary: h.evidence?.canary?.status ?? null,
      handoff: h.evidence?.handoff?.status ?? null,
      forecast: h.evidence?.forecast ?? null,
      release: h.releaseVersion ?? null,
    }));
    const autonomy = pmAgentAutonomy(await this.ownerSettings.get());
    return {
      counts: {
        runs: Number(runs),
        comments: fresh.comments.length + openOnly.length,
        failure_points: metrics.failure_points.length,
      },
      window_days: windowDays,
      comments_since_last_run: fresh.comments,
      comments_still_open: openOnly,
      metric_failure_points: metrics.failure_points,
      metrics: metrics.metrics,
      judge_and_evaluator: library,
      learner_flags: await this.learnerFeedback.signals(windowDays),
      reporting_catalog: this.reporting.catalog(),
      editable_prompts: editable,
      settings,
      idea_outcomes: outcomes,
      // Plan §11.7 "Ask a question": what people asked on items waiting for
      // approval, unanswered so far. Answer them in the report.
      open_questions:
        typeof this.pm.openQuestions === 'function'
          ? await this.pm.openQuestions().catch(() => [])
          : [],
      last_run: last
        ? {
            at: new Date(last.createdAt).toISOString(),
            status: last.detail?.status ?? null,
            ideas: last.detail?.ideaIds ?? [],
            refusals: last.detail?.refusals ?? [],
          }
        : null,
      autonomy: {
        mode: autonomy,
        meaning:
          autonomy === 'auto'
            ? 'you may start quick tests for the kinds the policy below allows; a person starts canaries, promotes, and approves Builder, Bug Hunter and person items'
            : 'propose and draft only; a person starts every quick test',
        // Per kind of change × test step: auto (on its own), ask (a person
        // starts it), off. Pinned rules are never yours to change.
        policy: this.autonomy
          ? ((await this.autonomy.policy().catch(() => null))?.matrix ?? null)
          : null,
      },
      metric_names: metrics.metric_names,
    };
  }
}
