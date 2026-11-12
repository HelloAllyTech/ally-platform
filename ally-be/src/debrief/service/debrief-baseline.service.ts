import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { OwnerSettingsBaseline } from '../constants/debrief-owner-settings.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  BaselineFacts,
  proposeOwnerSettings,
} from '../util/debrief-baseline.util';
import { DebriefRunJudgeService } from './debrief-run-judge.service';
import { DebriefSettingsService } from './debrief-settings.service';

/** Days of production data the baseline reads. */
const BASELINE_DAYS = 28;
/** Debriefs judged a second time to see how much scores move (~$0.04 each, learning budget). */
const REJUDGE_SAMPLE = 8;

/**
 * The baseline job (owner decision 2026-11-10): reads current production data
 * — sessions a day by organisation and language, the spread of judge scores
 * and how much they move on re-judging, hard-fail rates and cost per run —
 * and proposes starting values for every threshold, with the reasoning beside
 * each, in the Console. A person accepts them; budget changes always need a
 * person. It re-runs monthly and flags settings that no longer fit, but never
 * changes a setting itself. In-app, on ally-be's own connection.
 */
@Injectable()
export class DebriefBaselineService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefBaselineService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly judge: DebriefRunJudgeService,
    private readonly settings: DebriefSettingsService,
  ) {}

  onModuleInit(): void {
    // When this runs is set in Debrief › Settings › Schedules (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable('debrief-baseline', async () => {
      try {
        const b = await this.run();
        const n = Object.keys(b.proposals ?? {}).length;
        return `${n} value${n === 1 ? '' : 's'} proposed`;
      } catch (e) {
        this.logger.error(`[debrief] baseline failed: ${(e as Error).message}`);
        throw e;
      }
    });
  }

  /** Gather the facts, propose, store the proposal. Returns what it stored. */
  async run(): Promise<OwnerSettingsBaseline> {
    const facts = await this.facts();
    const current = await this.settings.get();
    const baseline: OwnerSettingsBaseline = {
      ranAt: new Date().toISOString(),
      facts: facts as unknown as Record<string, unknown>,
      proposals: proposeOwnerSettings(facts, current),
    };
    await this.settings.saveBaseline(baseline);
    const misfits = Object.entries(baseline.proposals)
      .filter(([, p]) => p?.misfit)
      .map(([k]) => k);
    this.logger.info(
      `[debrief] baseline: ${facts.runsPerDay.toFixed(1)} debriefs/day; ${
        misfits.length
          ? `no longer fitting: ${misfits.join(', ')}`
          : 'every setting fits'
      }`,
    );
    return baseline;
  }

  async facts(): Promise<BaselineFacts> {
    const d = BASELINE_DAYS;
    const [volume] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status <> 'skipped')::float / $1 AS per_day,
              count(*) FILTER (WHERE status <> 'skipped' AND mode = 'live')::float / $1 AS live_per_day
         FROM debrief_runs
        WHERE mode IN ('shadow','live') AND "createdAt" >= now() - make_interval(days => $1)`,
      [d],
    );
    const byOrgLanguage: Array<{
      tenant_id: string | null;
      language: string | null;
      per_day: number;
    }> = await this.dataSource.query(
      `SELECT tenant_id, language, (count(*)::float / $1) AS per_day
         FROM debrief_runs
        WHERE mode IN ('shadow','live') AND status <> 'skipped'
          AND "createdAt" >= now() - make_interval(days => $1)
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`,
      [d],
    );
    const [eligible] = await this.dataSource.query(
      `SELECT (count(*)::float * 30 / $1) AS per_month
         FROM scenario_sessions s
        WHERE s."endedAt" IS NOT NULL
          AND s."endedAt" >= now() - make_interval(days => $1)
          AND s."roomId" NOT LIKE 'preview-%' AND s."roomId" NOT LIKE 'seed-room-%'`,
      [d],
    );
    const [judged] = await this.dataSource.query(
      `SELECT count(*)::int AS n,
              avg(o) AS mean, stddev_samp(o) AS sd,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY o) AS median,
              avg(CASE WHEN hf > 0 THEN 1 ELSE 0 END) AS hard_fail_rate
         FROM (SELECT (workspace->'judge'->>'overall')::float AS o,
                      jsonb_array_length(COALESCE(workspace->'judge'->'hardFails', '[]'::jsonb)) AS hf
                 FROM debrief_runs
                WHERE mode IN ('shadow','live') AND workspace ? 'judge'
                  AND "createdAt" >= now() - make_interval(days => $1)) j
        WHERE o IS NOT NULL`,
      [d],
    );
    const [cost] = await this.dataSource.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY c) AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY c) AS p90
         FROM (SELECT COALESCE("actualCostUsd", "estimatedCostUsd")::float AS c
                 FROM debrief_runs
                WHERE mode IN ('shadow','live') AND status NOT IN ('skipped','failed')
                  AND "createdAt" >= now() - make_interval(days => $1)) x`,
      [d],
    );
    const [ideas] = await this.dataSource.query(
      `SELECT (count(*) FILTER (WHERE evidence ? 'screen')::float / 2) AS per_month
         FROM agent_lessons
        WHERE "agentKey" = 'debrief' AND "createdAt" >= now() - interval '60 days'`,
    );
    return {
      days: d,
      runsPerDay: Number(volume?.per_day ?? 0),
      liveRunsPerDay: Number(volume?.live_per_day ?? 0),
      eligibleSessionsPerMonth: Math.round(Number(eligible?.per_month ?? 0)),
      byOrgLanguage: byOrgLanguage.map((r) => ({
        tenantId: r.tenant_id,
        language: r.language,
        perDay: Number(Number(r.per_day).toFixed(2)),
      })),
      judge: {
        scored: Number(judged?.n ?? 0),
        mean: num(judged?.mean),
        sd: num(judged?.sd),
        median: num(judged?.median),
      },
      rejudge: await this.rejudge(),
      hardFailRate: num(judged?.hard_fail_rate),
      costPerRunUsd: { p50: num(cost?.p50), p90: num(cost?.p90) },
      ideasTriedPerMonth: Number(ideas?.per_month ?? 0),
    };
  }

  /**
   * Judge a few recent published debriefs again, without storing the new
   * score, and measure how far the two scores sit apart.
   */
  private async rejudge(): Promise<BaselineFacts['rejudge']> {
    const sample = await this.runs.find({
      where: {
        mode: In(['shadow', 'live']),
        status: In(['published', 'below_bar']),
      },
      order: { createdAt: 'DESC' },
      take: REJUDGE_SAMPLE * 3,
    });
    const diffs: number[] = [];
    for (const run of sample) {
      if (diffs.length >= REJUDGE_SAMPLE) break;
      const before = Number(run.workspace?.judge?.overall);
      if (!Number.isFinite(before)) continue;
      const again = await this.judge
        .judge(run, { store: false })
        .catch(() => null);
      if (again?.overall != null) diffs.push(again.overall - before);
    }
    if (diffs.length < 2) return { pairs: diffs.length, sdOfDifference: null };
    const m = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const v =
      diffs.reduce((a, b) => a + (b - m) * (b - m), 0) / (diffs.length - 1);
    return {
      pairs: diffs.length,
      sdOfDifference: Number(Math.sqrt(v).toFixed(3)),
    };
  }
}

const num = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v))
    ? null
    : Number(Number(v).toFixed(4));
