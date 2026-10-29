import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../../config/config.service';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import { debriefOverallSql } from '../../analytics/constants/debrief-quality.constants';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefAgentService } from './debrief-agent.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefTestSetsService } from './debrief-test-sets.service';
import {
  LEARNING_BUDGET_USD,
  DebriefImproverService,
} from './debrief-improver.service';

const num = (v: unknown, d = 2) =>
  v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;

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
    private readonly improver: DebriefImproverService,
    private readonly releases: AgentReleaseService,
    private readonly config: AppConfigService,
  ) {}

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
        learningSpentUsd: num(await this.improver.learningSpentThisMonth()),
        learningBudgetUsd: LEARNING_BUDGET_USD,
      },
      testSets: await this.testSets.counts(),
      liveTenants: await this.liveTenants(),
    };
  }

  async listRuns(opts: { mode?: string; status?: string; limit?: number }) {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    // Production by default: the Improver's replays are its experiments and
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
    Array<{ id: string; name: string; live: boolean; isTest: boolean }>
  > {
    const live = new Set(await this.agent.liveTenants());
    const rows = await this.dataSource.query(
      `SELECT id::text AS id, name, COALESCE("isTestOrganization", false) AS "isTest"
         FROM tenants WHERE "deletedAt" IS NULL ORDER BY name`,
    );
    return rows.map((t: { id: string; name: string; isTest: boolean }) => ({
      ...t,
      live: live.has(t.id),
    }));
  }
}
