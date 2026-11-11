import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import { debriefOverallSql } from '../../analytics/constants/debrief-quality.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import { LlmRuntime } from '../../llm/constants/llm-model-registry.constants';
import { LlmModelService } from '../../llm/service/llm-model.service';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_MODELS,
  DEBRIEF_REPLY_DEFAULT,
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
  DebriefStep,
  modelProblem,
  providerOfModel,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { DebriefRunnerService } from './debrief-runner.service';
import { DebriefAgentService, DebriefRegion } from './debrief-agent.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefTestSetsService } from './debrief-test-sets.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';

const num = (v: unknown, d = 2) =>
  v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;

/** The steps a person may pick a model for, in the order they run. */
export const PICKABLE_STEPS = [
  DebriefStep.SAFETY_READER,
  DebriefStep.ANALYST,
  DebriefStep.PROGRESS_READER,
  DebriefStep.WRITER,
  DebriefStep.EVALUATOR,
  DebriefStep.REVISER,
];
/**
 * Providers each place can call in production today. Both ally-be and
 * ally-ai have an Anthropic key (ally-ai's added 2 Nov 2026), and both can
 * run Claude, but the Anthropic account has no credit: every call is refused
 * ("credit balance is too low"). Add 'anthropic' to both once it has credit.
 */
const STEP_PROVIDERS: string[] = ['gemini', 'openai'];
const REPLY_PROVIDERS: string[] = ['gemini', 'openai'];

/** Read models for the Debrief Console: overview, runs, releases, tenants. */
@Injectable()
export class DebriefConsoleService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly agent: DebriefAgentService,
    private readonly context: DebriefContextRepository,
    private readonly testSets: DebriefTestSetsService,
    private readonly pmAgent: DebriefPmAgentService,
    private readonly releases: AgentReleaseService,
    private readonly config: AppConfigService,
    private readonly llmModels: LlmModelService,
    private readonly runner: DebriefRunnerService,
  ) {}

  /**
   * Each step's model in the live release, and the models a person may pick
   * for it: active in the LLM catalog where the step runs, from an approved
   * provider the runtime can call, pinned and priced. Steps and Ask Ally
   * both run in ally-ai. The judge is pinned and shown, never chosen.
   */
  async models() {
    const { release, bundle } = await this.runner.resolveRelease();
    const ai = await this.llmModels.getModels(LlmRuntime.ALLY_AI);
    const usable = (
      rows: Array<{ model: string; label: string }>,
      providers: string[],
    ) =>
      rows
        .filter(
          (m) =>
            !modelProblem(m.model) &&
            providers.includes(providerOfModel(m.model) as string),
        )
        .map((m) => ({
          model: m.model,
          label: m.label,
          provider: providerOfModel(m.model),
        }));
    const standard = bundle.recipes.standard.steps;
    return {
      releaseVersion: release?.version ?? null,
      steps: PICKABLE_STEPS.filter((st) =>
        standard.some((x) => x.step === st),
      ).map((st) => {
        const s = standard.find((x) => x.step === st)!;
        return {
          step: st,
          model: s.model ?? null,
          backupModel: s.backupModel ?? null,
        };
      }),
      reply: (bundle.reply ?? DEBRIEF_REPLY_DEFAULT).model,
      judge: DEBRIEF_MODELS.judge,
      choices: {
        steps: usable(ai, STEP_PROVIDERS),
        reply: usable(ai, REPLY_PROVIDERS),
      },
    };
  }

  /**
   * A person's model change, made the way every change is: a new release
   * from the live one, checked by the same rules (approved, priced, in the
   * catalog, the Writer and Evaluator on different models, neither on the
   * judge's), put live, and undone from Releases with Roll back.
   */
  async setModels(
    change: { steps?: Partial<Record<string, string>>; reply?: string },
    userId: number,
    note?: string,
  ) {
    const { bundle } = await this.runner.resolveRelease();
    const next = JSON.parse(JSON.stringify(bundle)) as DebriefBundle;
    const changed: string[] = [];
    for (const [step, model] of Object.entries(change.steps ?? {})) {
      if (!model) continue;
      if (!(PICKABLE_STEPS as string[]).includes(step)) {
        throw new BadRequestException(`${step} has no model to choose`);
      }
      if (!STEP_PROVIDERS.includes(providerOfModel(model) as string)) {
        throw new BadRequestException(
          `${model}: debrief steps can't run on this provider yet`,
        );
      }
      for (const recipe of Object.values(next.recipes)) {
        for (const s of recipe?.steps ?? []) {
          if (s.step === step && s.model !== model) {
            s.model = model;
            if (s.backupModel === model) s.backupModel = null;
            if (!changed.includes(step)) changed.push(step);
          }
        }
      }
    }
    if (change.reply) {
      const provider = providerOfModel(change.reply);
      if (!provider || !REPLY_PROVIDERS.includes(provider)) {
        throw new BadRequestException(
          `${change.reply}: Ask Ally can't run on this provider`,
        );
      }
      const reply = next.reply ?? { ...DEBRIEF_REPLY_DEFAULT };
      if (reply.model !== change.reply) {
        next.reply = { ...reply, provider, model: change.reply };
        changed.push('ask_ally');
      }
    }
    if (!changed.length) throw new BadRequestException('No model changed');
    const problems = validateDebriefBundle(
      next,
      await this.runner.modelCatalog(),
    );
    if (problems.length) throw new BadRequestException(problems.join('; '));
    const draft = await this.releases.createDraft(
      DEBRIEF_AGENT_KEY,
      next as unknown as Record<string, unknown>,
      userId,
      `Model change: ${changed.join(', ')}${note ? ` — ${note}` : ''}`,
    );
    await this.releases.makeGa(
      draft.id,
      userId,
      AgentReleaseAuditAction.PROMOTED,
      note,
    );
    return { releaseId: draft.id, version: draft.version, changed };
  }

  async overview(days = 7) {
    const [r] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status <> 'skipped')::int AS runs,
              count(*) FILTER (WHERE status = 'published')::int AS published,
              count(*) FILTER (WHERE status = 'below_bar')::int AS below_bar,
              count(*) FILTER (WHERE status = 'needs_person')::int AS needs_person,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              count(*) FILTER (WHERE "hasRiskCue")::int AS risk_cues,
              count(*) FILTER (WHERE workspace ? 'judge')::int AS judged,
              avg((workspace->'judge'->>'overall')::float) AS judge_mean,
              avg(CASE WHEN (workspace->'judge'->>'overall')::float >= 8
                        AND jsonb_array_length(workspace->'judge'->'hardFails') = 0 THEN 1 ELSE 0 END)
                FILTER (WHERE workspace ? 'judge') AS pass_rate,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE("actualCostUsd","estimatedCostUsd"))
                FILTER (WHERE status <> 'skipped') AS cost_p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY COALESCE("actualCostUsd","estimatedCostUsd"))
                FILTER (WHERE status <> 'skipped') AS cost_p90,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "finishedAt" - "startedAt"))
                FILTER (WHERE status <> 'skipped') AS secs_p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM "finishedAt" - "startedAt"))
                FILTER (WHERE status <> 'skipped') AS secs_p90
         FROM debrief_runs
        WHERE mode IN ('shadow','live') AND "createdAt" >= now() - make_interval(days => $1)`,
      [days],
    );
    const [today] = await this.dataSource.query(
      `SELECT count(*)::int AS n, avg(${debriefOverallSql('j')}) AS mean
         FROM debrief_quality_judgment j
        WHERE j."occurredAt" >= now() - make_interval(days => $1)`,
      [days],
    );
    const mtd = await this.context.monthToDate();
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
    const settings =
      ((ga?.bundle as any)?.settings as typeof DEBRIEF_SEED_BUNDLE.settings) ??
      DEBRIEF_SEED_BUNDLE.settings;
    return {
      windowDays: days,
      mode: this.config.debriefAgentMode,
      release: ga ? { id: ga.id, version: ga.version } : null,
      runs: {
        total: r.runs,
        published: r.published,
        belowBar: r.below_bar,
        needsPerson: r.needs_person,
        failed: r.failed,
        skipped: r.skipped,
        withRiskCue: r.risk_cues,
      },
      judge: {
        scored: r.judged,
        mean: num(r.judge_mean),
        passRate: num(r.pass_rate),
        todayMean: num(today?.mean),
        todayScored: Number(today?.n ?? 0),
      },
      costUsd: { p50: num(r.cost_p50, 4), p90: num(r.cost_p90, 4) },
      seconds: { p50: num(r.secs_p50, 0), p90: num(r.secs_p90, 0) },
      budget: {
        monthSpentUsd: num(mtd.spentUsd),
        monthlyCapUsd: settings.monthlyCapUsd,
        runCeilingUsd: settings.runCeilingUsd,
        learningSpentUsd: num(await this.pmAgent.learningSpentThisMonth()),
        learningBudgetUsd: num(await this.pmAgent.learningBudgetThisMonth()),
      },
      testSets: await this.testSets.counts(),
      liveTenants: await this.liveTenants(),
      languageIncidents: await this.languageIncidents(),
    };
  }

  /**
   * v9 FR-40: an organisation where more than 5% of today's debriefs had to
   * read the language from the transcript — its sessions are not recording
   * one, so the debrief language is a guess (flagged when unsure).
   */
  async languageIncidents(): Promise<
    Array<{
      tenantId: string;
      tenantName: string | null;
      runs: number;
      detected: number;
      unsure: number;
    }>
  > {
    const rows = await this.dataSource.query(
      `SELECT r.tenant_id, t.name,
              count(*)::int AS runs,
              count(*) FILTER (WHERE r.workspace->>'languageSource' LIKE 'detected%')::int AS detected,
              count(*) FILTER (WHERE r.workspace->>'languageSource' = 'detected_low_confidence')::int AS unsure
         FROM debrief_runs r
         LEFT JOIN tenants t ON t.id::text = r.tenant_id
        WHERE r.mode IN ('shadow','live') AND r.status <> 'skipped'
          AND r."createdAt" >= date_trunc('day', now())
        GROUP BY r.tenant_id, t.name
       HAVING count(*) FILTER (WHERE r.workspace->>'languageSource' LIKE 'detected%')
              > 0.05 * count(*)`,
    );
    return rows.map((r: any) => ({
      tenantId: r.tenant_id,
      tenantName: r.name ?? null,
      runs: Number(r.runs),
      detected: Number(r.detected),
      unsure: Number(r.unsure),
    }));
  }

  async listRuns(opts: { mode?: string; status?: string; limit?: number }) {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    // Production by default: the PM agent's replays are its experiments and
    // are read from its ideas, not mixed into what learners could see.
    let where = opts.mode
      ? `r.mode = ${p(opts.mode)}`
      : `r.mode IN ('shadow','live')`;
    if (opts.status) where += ` AND r.status = ${p(opts.status)}`;
    const rows = await this.dataSource.query(
      `SELECT r.id, r."scenarioSessionId", r.mode, r.status, r."skipReason", r."recipeKey",
              r."releaseVersion", r.language, r."learnerTurns", r."hasRiskCue", r."learnerDistress",
              r."fallbackRung", r."revisionRounds", r."evaluatorOverall",
              (r.workspace->'judge'->>'overall')::float AS "judgeOverall",
              COALESCE(r."actualCostUsd", r."estimatedCostUsd") AS "costUsd",
              extract(epoch FROM r."finishedAt" - r."startedAt")::int AS seconds,
              jsonb_array_length(r."checkFailures") AS "checkFailureCount",
              r."experimentId", r.arm, r."createdAt", t.name AS "tenantName"
         FROM debrief_runs r
         LEFT JOIN tenants t ON t.id::text = r.tenant_id
        WHERE ${where}
        ORDER BY r."createdAt" DESC
        LIMIT ${p(Math.min(opts.limit ?? 100, 500))}`,
      params,
    );
    return rows.map((x: Record<string, any>) => ({
      ...x,
      evaluatorOverall: num(x.evaluatorOverall),
      costUsd: num(x.costUsd, 4),
    }));
  }

  /**
   * v9 FR-38 "Registry": the recipe's steps as capabilities — for each step,
   * the model the GA release names, and over the last `days` of production
   * runs how often it ran, failed or was skipped, its typical time and its
   * estimated spend. Read from the runs' step timelines, so it shows what ran,
   * not what the recipe says.
   */
  async stepUsage(days = 30): Promise<
    Array<{
      step: string;
      model: string | null;
      backupModel: string | null;
      inRecipes: string[];
      done: number;
      failed: number;
      skipped: number;
      medianMs: number | null;
      estimatedUsd: number;
      models: string[];
    }>
  > {
    const { bundle } = await this.runner.resolveRelease();
    const rows: Array<{
      step: string;
      done: number;
      failed: number;
      skipped: number;
      median_ms: number | null;
      usd: number;
      models: string[] | null;
    }> = await this.dataSource.query(
      `SELECT s->>'step' AS step,
              count(*) FILTER (WHERE s->>'status' = 'done')::int AS done,
              count(*) FILTER (WHERE s->>'status' = 'failed')::int AS failed,
              count(*) FILTER (WHERE s->>'status' = 'skipped')::int AS skipped,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY (s->>'ms')::float)
                FILTER (WHERE s->>'status' = 'done') AS median_ms,
              COALESCE(sum((s->>'estimatedUsd')::float), 0)::float AS usd,
              array_remove(array_agg(DISTINCT s->>'model'), NULL) AS models
         FROM debrief_runs r, jsonb_array_elements(COALESCE(r.steps, '[]'::jsonb)) s
        WHERE r.mode IN ('shadow','live')
          AND r."createdAt" >= now() - make_interval(days => $1)
        GROUP BY 1`,
      [days],
    );
    const byStep = new Map(rows.map((r) => [r.step, r]));
    const steps = new Map<
      string,
      { model: string | null; backupModel: string | null; recipes: string[] }
    >();
    for (const recipe of Object.values(bundle.recipes)) {
      for (const st of recipe.steps) {
        const seen = steps.get(st.step);
        if (seen) seen.recipes.push(recipe.key);
        else
          steps.set(st.step, {
            model: st.model ?? null,
            backupModel: st.backupModel ?? null,
            recipes: [recipe.key],
          });
      }
    }
    return [...steps.entries()].map(([step, st]) => {
      const u = byStep.get(step);
      return {
        step,
        model: st.model,
        backupModel: st.backupModel,
        inRecipes: st.recipes,
        done: u?.done ?? 0,
        failed: u?.failed ?? 0,
        skipped: u?.skipped ?? 0,
        medianMs: u?.median_ms != null ? Math.round(u.median_ms) : null,
        estimatedUsd: Number((u?.usd ?? 0).toFixed(4)),
        models: u?.models ?? [],
      };
    });
  }

  async getRun(id: string) {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async listReleases() {
    const list = await this.releases.list(DEBRIEF_AGENT_KEY);
    return list.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      authorKind: r.authorKind,
      notes: r.notes ?? null,
      createdAt: r.createdAt,
      promotedAt: (r as any).promotedAt ?? null,
      prompts: (r.bundle as any)?.prompts ?? {},
      settings: (r.bundle as any)?.settings ?? {},
      maxRevisionRounds:
        (r.bundle as any)?.recipes?.standard?.maxRevisionRounds ?? null,
    }));
  }

  async rollback(releaseId: string, userId: number, reason?: string) {
    const r = await this.releases.makeGa(
      releaseId,
      userId,
      AgentReleaseAuditAction.ROLLED_BACK,
      reason,
    );
    return { id: r.id, version: r.version };
  }

  async liveTenants(): Promise<Array<{ id: string; name: string }>> {
    const ids = await this.agent.liveTenants();
    if (!ids.length) return [];
    return this.dataSource.query(
      `SELECT id::text AS id, name FROM tenants WHERE id::text = ANY($1) ORDER BY name`,
      [ids],
    );
  }

  async tenants(): Promise<
    Array<{
      id: string;
      name: string;
      live: boolean;
      isTest: boolean;
      region: DebriefRegion;
      hasSupportContact: boolean;
      /** v9 FR-8: this calendar month's production spend (shadow + live), actual where reconciled. */
      monthSpentUsd: number;
      monthRuns: number;
    }>
  > {
    const [live, regions, spend] = await Promise.all([
      this.agent.liveTenants().then((ids) => new Set(ids)),
      this.agent.regions(),
      this.dataSource
        .query(
          `SELECT tenant_id AS id,
                  COALESCE(sum(COALESCE("actualCostUsd", "estimatedCostUsd")), 0)::float AS spent,
                  count(*) FILTER (WHERE status <> 'skipped')::int AS runs
             FROM debrief_runs
            WHERE mode IN ('shadow','live')
              AND "createdAt" >= date_trunc('month', now())
              AND tenant_id IS NOT NULL
            GROUP BY tenant_id`,
        )
        .then(
          (rows: Array<{ id: string; spent: number; runs: number }>) =>
            new Map(rows.map((r) => [String(r.id), r])),
        ),
    ]);
    const rows = await this.dataSource.query(
      `SELECT t.id::text AS id, t.name, COALESCE(t."isTestOrganization", false) AS "isTest",
              EXISTS (SELECT 1 FROM guide_org_profiles g, jsonb_each(COALESCE(g.profile->'supportLines', '{}'::jsonb)) l
                       WHERE g.tenant_id = t.id::text AND jsonb_typeof(l.value) = 'array'
                         AND jsonb_array_length(l.value) > 0) AS "hasSupportContact"
         FROM tenants t WHERE t."deletedAt" IS NULL ORDER BY t.name`,
    );
    return rows.map(
      (t: {
        id: string;
        name: string;
        isTest: boolean;
        hasSupportContact: boolean;
      }) => ({
        ...t,
        live: live.has(t.id),
        region: regions.get(t.id) ?? 'india',
        monthSpentUsd: Number((spend.get(t.id)?.spent ?? 0).toFixed(4)),
        monthRuns: Number(spend.get(t.id)?.runs ?? 0),
      }),
    );
  }
}
