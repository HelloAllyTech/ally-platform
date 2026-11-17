import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  aggregateGuidanceMetrics,
  entryCodesOf,
  GuidanceLogFacts,
  GuidanceMetrics,
  GuidanceMetricsMode,
  GuidanceRunFacts,
  parseGuidanceMetricsQuery,
} from '../util/debrief-guidance-metrics.util';

/** The newest runs read per window: the prod table is small, this keeps a query bounded. */
export const GUIDANCE_METRICS_MAX_RUNS = 5000;

/**
 * Debrief Guidance analytics for the Console and the PM agent
 * (`GET /v1/debriefs/console/guidance-metrics`, PM tool `guidance_report`).
 * Reads only the guidance slices of the run workspace and three step logs;
 * never transcript text. Windowed on `createdAt` (indexed).
 */
@Injectable()
export class DebriefGuidanceMetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async report(
    input: { days?: unknown; mode?: unknown } = {},
  ): Promise<GuidanceMetrics> {
    const { days, mode } = parseGuidanceMetricsQuery(input);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const runs = await this.runs(from, mode);
    const codes = entryCodesOf(runs);
    return aggregateGuidanceMetrics({
      runs,
      from,
      to,
      days,
      mode,
      chunks: await this.titles(codes),
    });
  }

  private async runs(
    from: Date,
    mode: GuidanceMetricsMode,
  ): Promise<GuidanceRunFacts[]> {
    const modes = mode === 'all' ? ['live', 'shadow'] : [mode];
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT r.id, r."createdAt",
              r.workspace->'guidanceMode'    AS guidance_mode,
              r.workspace->'guidanceCalls'   AS guidance_calls,
              r.workspace->'guidanceGiven'   AS guidance_given,
              r.workspace->'guidanceTimings' AS guidance_timings,
              r.workspace->'passages'        AS passages,
              r."evaluatorOverall"::text     AS evaluator_overall,
              r.workspace->'judge'->>'overall' AS judge_overall,
              r."estimatedCostUsd"::text     AS cost
         FROM debrief_runs r
        WHERE r."createdAt" >= $1
          AND r.mode = ANY($2)
          AND r.status NOT IN ('queued', 'running', 'skipped')
        ORDER BY r."createdAt" DESC
        LIMIT ${GUIDANCE_METRICS_MAX_RUNS}`,
      [from, modes],
    );
    if (!rows.length) return [];
    const logs: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT l.run_id, l.step, l.kind, l.ms, l.error,
              CASE WHEN l.step = 'planner' THEN l.output->'actions' END AS actions,
              CASE WHEN l.step = 'planner' THEN l.output->'considered' END AS considered
         FROM debrief_run_logs l
        WHERE l.run_id = ANY($1::uuid[])
          AND l.step IN ('planner', 'guidance_lookup', 'guidance_agent')`,
      [rows.map((r) => r.id)],
    );
    const byRun = new Map<string, GuidanceLogFacts[]>();
    for (const l of logs) {
      const list = byRun.get(l.run_id) ?? [];
      list.push({
        step: l.step,
        kind: l.kind,
        ms: l.ms,
        error: l.error,
        actions: l.actions,
        considered: l.considered,
      });
      byRun.set(l.run_id, list);
    }
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      guidanceMode: r.guidance_mode,
      guidanceCalls: r.guidance_calls,
      guidanceGiven: r.guidance_given,
      guidanceTimings: r.guidance_timings,
      passages: r.passages,
      judge: r.evaluator_overall ?? r.judge_overall,
      costUsd: r.cost,
      logs: byRun.get(r.id) ?? [],
    }));
  }

  private async titles(
    codes: string[],
  ): Promise<Map<string, { title: string; kind: string | null }>> {
    const out = new Map<string, { title: string; kind: string | null }>();
    if (!codes.length) return out;
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT code,
              COALESCE(NULLIF(trim(citation->>'title'), ''), statement) AS title,
              facets->>'kind' AS kind
         FROM cl_chunks WHERE code = ANY($1)`,
      [codes],
    );
    for (const r of rows) {
      const t = String(r.title ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      out.set(r.code, {
        title: t.length > 120 ? `${t.slice(0, 119).trimEnd()}…` : t,
        kind: r.kind ?? null,
      });
    }
    return out;
  }
}
