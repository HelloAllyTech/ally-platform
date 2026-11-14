import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SqlExecutorService } from '../../analytics-agent/service/sql-executor.service';
import { guardSelectQuery } from '../../analytics-agent/util/sql-guard.util';
import { LoggerService } from '../../logger/logger.service';
import { DebriefRun } from '../entity/debrief-run.entity';

/**
 * The only relation `query_aggregates` may read: one row per skill the
 * Analyst judged in a run (migration 1981900720000). No quote, no note, no
 * transcript, and the learner as a one-way key, so nothing here can carry a
 * learner's words or name.
 */
export const DEBRIEF_AGGREGATE_VIEWS: Readonly<Record<string, string>> =
  Object.freeze({
    'debrief_reporting.skill_observations':
      'one row per run and skill the Analyst judged: run_id, created_at, tenant_id, is_test_org, mode, status, scenario_id, track_id, learner_key (one-way), skill (lower-cased), opportunity, observation (observed/partial/missed)',
  });

/** No aggregate below this many learners (v9 FR-17, spec A4). */
export const AGGREGATE_MIN_GROUP = 5;

/** The fixed family of queries (spec A4): never free SQL from the debrief. */
export const DEBRIEF_AGGREGATE_QUERIES = [
  'cohort_skill_rates',
  'course_missed_skills',
] as const;
export type DebriefAggregateQuery = (typeof DEBRIEF_AGGREGATE_QUERIES)[number];

/** A skill name as the query may carry it: short, printable, a literal. */
const SKILL_RE = /^[\p{L}\p{M}\p{N} ,.'()/&-]{1,60}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_SKILLS = 10;

export type AggregateResult = {
  query: string;
  rows: Array<Record<string, unknown>>;
  min_group: number;
  refused?: string;
};

/** A SQL string literal; the value is already checked against a strict pattern. */
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * `query_aggregates` (spec A4): a fixed family of parameterised aggregate
 * queries over the redacted view above, scoped by code to the run's own
 * organisation (and course) and excluding its learner; groups of fewer than
 * five learners are never returned. Every query is built here from checked
 * parameters and still goes through the Analytics Agent's guard (only the
 * view, one SELECT, no comments, no writes) and executor (READ ONLY
 * transaction, statement timeout, row cap), so a bug here is a refusal or a
 * wrong count, never a write or a leak.
 */
@Injectable()
export class DebriefAggregatesService {
  private readonly logger = LoggerService.getInstance(
    DebriefAggregatesService.name,
  );
  private readonly executor: SqlExecutorService;

  constructor(private readonly dataSource: DataSource) {
    this.executor = new SqlExecutorService(dataSource);
  }

  /** The run's scope, read here: never taken from what the graph sends. */
  private async scope(run: DebriefRun) {
    const [r] = await this.dataSource.query(
      `SELECT s.tenant_id, s."counselorId" AS counselor_id, ti."trackId" AS track_id
         FROM scenario_sessions s
         LEFT JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
         LEFT JOIN track_items ti ON ti.id = tip."trackItemId"
        WHERE s.id = $1`,
      [run.scenarioSessionId],
    );
    return {
      tenantId: (r?.tenant_id as string | null) ?? null,
      counselorId: r?.counselor_id == null ? null : Number(r.counselor_id),
      trackId: (r?.track_id as string | null) ?? null,
    };
  }

  /** The SQL for one query, or why it may not run. */
  build(
    query: string,
    params: Record<string, unknown>,
    scope: {
      tenantId: string | null;
      counselorId: number | null;
      trackId: string | null;
    },
  ): { sql: string } | { refused: string } {
    if (!DEBRIEF_AGGREGATE_QUERIES.includes(query as DebriefAggregateQuery)) {
      return { refused: `no aggregate query ${String(query).slice(0, 40)}` };
    }
    if (!scope.tenantId || !SAFE_ID_RE.test(scope.tenantId)) {
      return { refused: 'the session has no organisation' };
    }
    const me = Number.isInteger(scope.counselorId)
      ? `md5('learner:' || ${scope.counselorId})`
      : `''`;
    const base = `tenant_id = ${lit(scope.tenantId)}
         AND learner_key <> ${me}
         AND opportunity
         AND mode IN ('shadow','live') AND status IN ('published','below_bar')
         AND created_at > now() - interval '90 days'`;
    const latest = (where: string) => `WITH latest AS (
       SELECT DISTINCT ON (learner_key, skill) learner_key, skill, observation
         FROM debrief_reporting.skill_observations
        WHERE ${base} AND ${where}
        ORDER BY learner_key, skill, created_at DESC
     )`;
    if (query === 'cohort_skill_rates') {
      const raw = Array.isArray(params?.skills) ? params.skills : [];
      const skills = [
        ...new Set(
          raw
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim().toLowerCase())
            .filter((s) => SKILL_RE.test(s)),
        ),
      ].slice(0, MAX_SKILLS);
      if (!skills.length) return { refused: 'no skills to compare' };
      return {
        sql: `${latest(`skill IN (${skills.map(lit).join(', ')})`)}
     SELECT skill, count(*) AS learners,
            round(avg((observation = 'observed')::int)::numeric, 2) AS observed_share
       FROM latest
      GROUP BY skill
     HAVING count(*) >= ${AGGREGATE_MIN_GROUP}
      ORDER BY skill`,
      };
    }
    if (!scope.trackId || !SAFE_ID_RE.test(scope.trackId)) {
      return { refused: 'the session is not part of a course' };
    }
    return {
      sql: `${latest(`track_id = ${lit(scope.trackId)}`)}
     SELECT skill, count(*) AS learners,
            round(avg((observation = 'missed')::int)::numeric, 2) AS missed_share
       FROM latest
      GROUP BY skill
     HAVING count(*) >= ${AGGREGATE_MIN_GROUP}
      ORDER BY missed_share DESC, skill
      LIMIT 10`,
    };
  }

  /** One query for one run. A refusal or a failure is an answer, never a throw. */
  async run(
    run: DebriefRun,
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<AggregateResult> {
    const out: AggregateResult = {
      query,
      rows: [],
      min_group: AGGREGATE_MIN_GROUP,
    };
    const built = this.build(query, params, await this.scope(run));
    if ('refused' in built) return { ...out, refused: built.refused };
    const guard = guardSelectQuery(
      built.sql,
      DEBRIEF_AGGREGATE_VIEWS,
      'the debrief',
    );
    if (!guard.ok) return { ...out, refused: guard.reason };
    try {
      const res = await this.executor.run(guard.sql);
      return {
        ...out,
        // The HAVING already holds; this holds even if a query is ever wrong.
        rows: res.rows
          .filter((r) => Number(r.learners) >= AGGREGATE_MIN_GROUP)
          .map((r) => ({
            skill: r.skill,
            learners: Number(r.learners),
            ...(r.observed_share != null
              ? { observed_share: Number(r.observed_share) }
              : {}),
            ...(r.missed_share != null
              ? { missed_share: Number(r.missed_share) }
              : {}),
          })),
      };
    } catch (e) {
      this.logger.warn(
        `[debrief] aggregate ${query} failed: ${(e as Error).message.slice(0, 200)}`,
      );
      return { ...out, refused: 'the query failed to run' };
    }
  }
}
