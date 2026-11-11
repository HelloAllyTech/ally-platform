import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SqlExecutorService } from '../../analytics-agent/service/sql-executor.service';
import { guardSelectQuery } from '../../analytics-agent/util/sql-guard.util';
import { LoggerService } from '../../logger/logger.service';

/**
 * The only relations the PM agent may read (owner-approved 2026-11-10, v9
 * item 63 / G-4): redacted views over debrief runs, steps, judge scores,
 * learner responses, ideas and paired trials (migration 1981002100000). No
 * cards, workspace, notes, transcripts or anything a learner wrote.
 */
export const DEBRIEF_REPORTING_VIEWS: Readonly<Record<string, string>> =
  Object.freeze({
    'debrief_reporting.runs':
      'one row per debrief run: id, created_at, tenant_id, is_test_org, mode (shadow/live/replay), status, skip_reason, recipe, release_version, experiment_id, arm, language, learner_turns, has_risk_cue, learner_distress, fallback_rung, revision_rounds, ceiling_usd, estimated_cost_usd, actual_cost_usd, evaluator_overall, judge_overall (0-10), judge_hard_fails (text[] codes), evaluator_hard_fails (text[]), check_failures (text[]), seconds, resumes, language_source',
    'debrief_reporting.steps':
      'one row per step of a run: run_id, created_at, mode, step, status (done/failed/skipped), model, ms, estimated_usd, round',
    'debrief_reporting.judge_scores':
      'one row per judged run and rubric dimension: run_id, created_at, mode, language, recipe, release_version, dimension, score',
    'debrief_reporting.learner_responses':
      'one row per learner response to a live debrief: run_id, created_at, tenant_id, kind (helpful/flag), helpful (bool), section (which card), reason (flag reason code), urgent, status',
    'debrief_reporting.ideas':
      'one row per PM agent idea: id, created_at, updated_at, status, idea_kind, prompt_code, setting_key, text, release_id, quick_test_lift, quick_test_passed, gate_passed, trial_status, canary_status',
    'debrief_reporting.learner_events':
      'one row per thing a learner did with a live debrief, once per session and kind: created_at, tenant_id, run_id, kind (opened/read_through/listened/practise_next_click/reflection_answered/replied/waited/left_before_ready), platform (web/ios/android or null)',
    'debrief_reporting.probes':
      'one row per paired trial on a production session: id, created_at, tenant_id, idea_id, baseline_overall, challenger_overall, baseline_hard_fails, challenger_hard_fails, cost_usd, status',
  });

/** Rows of one follow-up query sent back to the model, at most. */
const QUERY_ROWS_TO_MODEL = 100;

export interface ReportingQueryResult {
  sql: string;
  ok: boolean;
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  refused?: string;
}

/**
 * The PM agent's read path (v9 FR-61): a library of parameterised queries it
 * always gets, and read-only SQL it may ask for, run through the Analytics
 * Agent's guard (only the views above; refused columns; one SELECT, no
 * comments, no writes) and executor (READ ONLY transaction, statement
 * timeout, row cap) on ally-be's own connection.
 */
@Injectable()
export class DebriefReportingService {
  private readonly logger = LoggerService.getInstance(
    DebriefReportingService.name,
  );
  private readonly executor: SqlExecutorService;

  constructor(dataSource: DataSource) {
    this.executor = new SqlExecutorService(dataSource);
  }

  /** The catalogue the model reads before writing a query. */
  catalog(): string {
    return Object.entries(DEBRIEF_REPORTING_VIEWS)
      .map(([name, cols]) => `- ${name}: ${cols}`)
      .join('\n');
  }

  /** One guarded read-only query. A refusal or failure is a result, never a throw. */
  async query(sql: string): Promise<ReportingQueryResult> {
    const guard = guardSelectQuery(
      sql,
      DEBRIEF_REPORTING_VIEWS,
      'the PM agent',
    );
    if (!guard.ok) return { sql, ok: false, refused: guard.reason };
    try {
      const res = await this.executor.run(guard.sql);
      return {
        sql: guard.sql,
        ok: true,
        rows: res.rows.slice(0, QUERY_ROWS_TO_MODEL),
        truncated: res.truncated || res.rows.length > QUERY_ROWS_TO_MODEL,
      };
    } catch (e) {
      this.logger.warn(
        `[pm-agent] a follow-up query failed: ${(e as Error).message.slice(0, 200)}`,
      );
      return { sql: guard.sql, ok: false, refused: 'the query failed to run' };
    }
  }

  /**
   * The fixed library over the last `days` of production runs (test
   * organisations included and marked): what the PM agent reads every time,
   * before it asks for anything else.
   */
  async library(days: number): Promise<Record<string, unknown>> {
    const d = Math.max(1, Math.min(120, Math.round(days)));
    const window = `created_at >= now() - interval '${d} days'`;
    const prod = `mode IN ('shadow','live')`;
    const named: Record<string, string> = {
      byLanguageAndRecipe: `
        SELECT language, recipe, count(*) AS runs,
               round(avg((status = 'published')::int)::numeric, 3) AS published_share,
               round(avg((status = 'below_bar')::int)::numeric, 3) AS below_bar_share,
               round(avg((status = 'needs_person')::int)::numeric, 3) AS needs_person_share,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY judge_overall) AS judge_median,
               round(avg((cardinality(judge_hard_fails) > 0)::int)::numeric, 3) AS hard_fail_share,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_cost_usd) AS cost_median,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS seconds_median
          FROM debrief_reporting.runs
         WHERE ${prod} AND ${window} AND status <> 'skipped'
         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40`,
      hardFails: `
        SELECT code, count(*) AS n FROM debrief_reporting.runs, unnest(judge_hard_fails) AS code
         WHERE ${prod} AND ${window} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      checkFailures: `
        SELECT code, count(*) AS n FROM debrief_reporting.runs, unnest(check_failures) AS code
         WHERE ${prod} AND ${window} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      dimensions: `
        SELECT dimension, round(avg(score)::numeric, 2) AS mean, count(*) AS n
          FROM debrief_reporting.judge_scores
         WHERE ${prod} AND ${window} GROUP BY 1 ORDER BY 2`,
      steps: `
        SELECT step, model, count(*) AS n,
               round(avg((status = 'failed')::int)::numeric, 3) AS failed_share,
               round(avg((status = 'skipped')::int)::numeric, 3) AS skipped_share,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS ms_median
          FROM debrief_reporting.steps
         WHERE ${prod} AND ${window} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`,
      learnerResponses: `
        SELECT kind, reason, section, count(*) AS n,
               round(avg(helpful::int)::numeric, 3) AS helpful_share
          FROM debrief_reporting.learner_responses
         WHERE ${window} GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 30`,
      weekly: `
        SELECT date_trunc('week', created_at) AS week, count(*) AS runs,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY judge_overall) AS judge_median,
               round(avg((cardinality(judge_hard_fails) > 0)::int)::numeric, 3) AS hard_fail_share
          FROM debrief_reporting.runs
         WHERE ${prod} AND created_at >= now() - interval '${Math.max(d, 56)} days'
         GROUP BY 1 ORDER BY 1`,
      ideas: `
        SELECT idea_kind, status, count(*) AS n,
               round(avg(quick_test_lift)::numeric, 2) AS mean_quick_lift,
               sum(quick_test_passed::int) AS quick_passed, sum(gate_passed::int) AS gate_passed
          FROM debrief_reporting.ideas
         WHERE created_at >= now() - interval '120 days' GROUP BY 1, 2 ORDER BY 3 DESC`,
    };
    const out: Record<string, unknown> = {};
    for (const [name, sql] of Object.entries(named)) {
      const res = await this.query(sql);
      out[name] = res.ok ? res.rows : { unavailable: res.refused };
    }
    return out;
  }
}
