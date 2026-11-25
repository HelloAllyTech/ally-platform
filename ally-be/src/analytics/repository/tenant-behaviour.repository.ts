import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';

/** Learners needed before a share of learners means anything. */
export const BEHAVIOUR_MIN_LEARNERS = 5;
/** A point on the unhelpful-over-time line needs this many learners behind it (organisation-wide). */
export const UNHELPFUL_TREND_MIN_LEARNERS = 3;
const BEHAVIOUR_ROWS = 6;
const TREND_SLICES = 12;
const ATTEMPT_MIN_LEARNERS = 3;
const MAX_ATTEMPT_BAND = 4;

export interface BehaviourScope {
  courseId?: string;
  learnerId?: number;
}

export interface HelpfulBehaviourRow {
  code: string;
  skill: string;
  text: string;
  /** Share of learners (0 to 100) seen doing it in their first scored practice. */
  beforePercent: number;
  /** The same, in their latest. */
  afterPercent: number;
}

export interface HelpfulBehavioursData {
  /** Learners with two or more scored practice slices. */
  learners: number;
  rows: HelpfulBehaviourRow[];
}

export interface UnhelpfulTrendData {
  points: Array<{
    slice: number;
    /** Share of scored assessments in the slice with an unhelpful behaviour. */
    sharePercent: number;
    assessments: number;
  }>;
}

export interface ScoreByAttemptData {
  steps: Array<{
    /** 1, 2, 3 and 4, where 4 means four or more. */
    attempt: number;
    learners: number;
    averageScore: number;
  }>;
}

const rubricByCode = new Map(
  FHS_RUBRIC.flatMap((skill) =>
    [...skill.basic, ...skill.advanced].map((b) => [
      b.code,
      { skill: skill.name, text: b.text },
    ]),
  ),
);

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Behaviour and attempt aggregates for the Statistics charts. Reads the
 * helping-skills assessments (`verdicts` hold behaviour codes, never quotes) and
 * scored roleplay sessions. Aggregates only: no names, no text a learner said.
 */
@Injectable()
export class TenantBehaviourRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The scored assessments in scope, as a CTE body. Parameters: $1 tenant id, $2 code, $3 rubric. */
  private scoped(scope: BehaviourScope): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    let filter = '';
    if (scope.learnerId !== undefined) {
      params.push(scope.learnerId);
      filter += ` AND c."userId" = $${3 + params.length}`;
    }
    if (scope.courseId) {
      params.push(scope.courseId);
      filter += ` AND EXISTS (
          SELECT 1 FROM unnest(c."sessionIds") sid
            JOIN scenario_sessions ss ON ss.id = sid
            JOIN track_item_progress p ON p.id = ss."trackItemProgressId"
            JOIN track_items i ON i.id = p."trackItemId"
           WHERE i."trackId" = $${3 + params.length}::uuid)`;
    }
    return {
      sql: `SELECT c.id AS cut_id, c."userId" AS uid, c."cutIndex" AS idx,
                   a.verdicts, a."hasUnhelpfulBehaviour" AS unhelpful
              FROM foundational_skill_cuts c
              JOIN foundational_skill_assessments a
                ON a."cutId" = c.id AND a.status = 'SCORED' AND a."rubricVersion" = $3
             WHERE c.tenant_id::text IN ($1, $2)${filter}`,
      params,
    };
  }

  /** Which helpful behaviours learners show more of in their latest practice than in their first. */
  async getHelpfulBehaviours(
    tenantId: string,
    tenantCode: string,
    scope: BehaviourScope,
  ): Promise<HelpfulBehavioursData> {
    const { sql, params } = this.scoped(scope);
    const rows: Array<{
      uid: number;
      which: 'first' | 'last';
      codes: string[];
    }> = await this.dataSource.query(
      `WITH scoped AS (${sql}),
              ends AS (
                SELECT uid,
                       (ARRAY_AGG(cut_id ORDER BY idx ASC))[1] AS first_id,
                       (ARRAY_AGG(cut_id ORDER BY idx DESC))[1] AS last_id
                  FROM scoped GROUP BY uid HAVING COUNT(*) >= 2
              ),
              picked AS (
                SELECT uid, 'first' AS which, first_id AS cut_id FROM ends
                UNION ALL
                SELECT uid, 'last' AS which, last_id AS cut_id FROM ends
              )
         SELECT pk.uid, pk.which,
                COALESCE(ARRAY_AGG(DISTINCT o.code) FILTER (WHERE o.code IS NOT NULL), '{}') AS codes
           FROM picked pk
           JOIN scoped s ON s.cut_id = pk.cut_id
           LEFT JOIN LATERAL (
                SELECT jsonb_array_elements_text(v->'observed') AS code
                  FROM jsonb_array_elements(s.verdicts) v
           ) o ON true
          GROUP BY pk.uid, pk.which`,
      [tenantId, tenantCode, FHS_RUBRIC_VERSION, ...params],
    );
    const learners = new Set(rows.map((r) => Number(r.uid))).size;
    if (learners < BEHAVIOUR_MIN_LEARNERS) return { learners, rows: [] };

    const seen = {
      first: new Map<string, number>(),
      last: new Map<string, number>(),
    };
    rows.forEach((r) =>
      (r.codes ?? []).forEach((code) =>
        seen[r.which].set(code, (seen[r.which].get(code) ?? 0) + 1),
      ),
    );
    const percent = (n: number) => round1((n / learners) * 100);
    const out: HelpfulBehaviourRow[] = [];
    rubricByCode.forEach((info, code) => {
      const before = seen.first.get(code) ?? 0;
      const after = seen.last.get(code) ?? 0;
      if (before === 0 && after === 0) return;
      out.push({
        code,
        skill: info.skill,
        text: info.text,
        beforePercent: percent(before),
        afterPercent: percent(after),
      });
    });
    out.sort(
      (a, b) =>
        b.afterPercent - b.beforePercent - (a.afterPercent - a.beforePercent) ||
        a.code.localeCompare(b.code),
    );
    return { learners, rows: out.slice(0, BEHAVIOUR_ROWS) };
  }

  /** The share of scored practice slices with an unhelpful behaviour, slice by slice. */
  async getUnhelpfulTrend(
    tenantId: string,
    tenantCode: string,
    scope: BehaviourScope,
  ): Promise<UnhelpfulTrendData> {
    const { sql, params } = this.scoped(scope);
    const wholeGroup = scope.learnerId === undefined;
    const rows: Array<{ idx: number; assessments: string; flagged: string }> =
      await this.dataSource.query(
        `WITH scoped AS (${sql})
         SELECT idx, COUNT(*) AS assessments,
                COUNT(*) FILTER (WHERE unhelpful) AS flagged
           FROM scoped
          GROUP BY idx
          ${wholeGroup ? `HAVING COUNT(DISTINCT uid) >= ${UNHELPFUL_TREND_MIN_LEARNERS}` : ''}
          ORDER BY idx ASC`,
        [tenantId, tenantCode, FHS_RUBRIC_VERSION, ...params],
      );
    const points = rows
      .map((r) => ({
        slice: Number(r.idx),
        assessments: Number(r.assessments),
        sharePercent: round1((Number(r.flagged) / Number(r.assessments)) * 100),
      }))
      .slice(-TREND_SLICES);
    return { points: points.length >= 2 ? points : [] };
  }

  /** Average session score at each attempt, over learners who played a roleplay more than once. */
  async getScoreByAttempt(
    tenantId: string,
    tenantCode: string,
  ): Promise<ScoreByAttemptData> {
    const rows: Array<{
      attempt: number;
      learners: string;
      avg_score: string;
    }> = await this.dataSource.query(
      `WITH played AS (
           SELECT s."counselorId" AS uid, s."scenarioId" AS sc, d."compositeScore" AS score,
                  ROW_NUMBER() OVER (
                    PARTITION BY s."counselorId", s."scenarioId" ORDER BY s."startedAt"
                  ) AS n
             FROM scenario_sessions s
             JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
            WHERE s.tenant_id::text IN ($1, $2)
              AND d."compositeScore" IS NOT NULL
         ),
         repeaters AS (
           SELECT uid, sc FROM played GROUP BY uid, sc HAVING COUNT(*) >= 2
         )
         SELECT LEAST(p.n, ${MAX_ATTEMPT_BAND}) AS attempt,
                COUNT(DISTINCT p.uid) AS learners,
                AVG(p.score) AS avg_score
           FROM played p
           JOIN repeaters r ON r.uid = p.uid AND r.sc = p.sc
          GROUP BY 1
          ORDER BY 1`,
      [tenantId, tenantCode],
    );
    const steps = rows
      .filter((r) => Number(r.learners) >= ATTEMPT_MIN_LEARNERS)
      .map((r) => ({
        attempt: Number(r.attempt),
        learners: Number(r.learners),
        averageScore: Math.round(Number(r.avg_score)),
      }));
    return { steps: steps.length >= 2 ? steps : [] };
  }
}
