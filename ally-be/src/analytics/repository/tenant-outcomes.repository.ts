import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ScoreDistributionRow {
  /** Ten bins: 0-9, 10-19, ... 90-100. */
  bins: number[];
  sessions: number;
  median: number | null;
}

export interface LearnerTrendCounts {
  improving: number;
  holding: number;
  declining: number;
}

export interface ScenarioScoreRow {
  scenarioId: number;
  title: string;
  averageScore: number;
  sessions: number;
}

export interface RatingCounts {
  /** Index 0 is one star, index 4 is five stars. */
  stars: number[];
  count: number;
  average: number | null;
}

export interface ReviewCoverage {
  completedSessions: number;
  reviewedSessions: number;
}

/**
 * Outcome and feedback aggregates for one tenant, for the Statistics charts
 * that need their own queries.
 *
 * Scores are the judged composite (`scenario_session_details.compositeScore`,
 * 0 to 100): the one score on a single scale across scenarios, so it can be
 * averaged and compared. `scenario_sessions.score` is a running points total
 * that differs by scenario and is not used here.
 *
 * Several tables store the tenant as a VARCHAR that holds either the tenant uuid
 * or its code, so every match is `IN ($1, $2)` on `::text` with both spellings.
 * Windows are `[start, endExclusive)` on the session's `startedAt`. Aggregates
 * only: nothing here returns a name, an email or free text.
 */
@Injectable()
export class TenantOutcomesRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getScoreDistribution(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
  ): Promise<ScoreDistributionRow> {
    const rows: Array<{ bin: number; n: string }> = await this.dataSource.query(
      `SELECT LEAST(FLOOR(d."compositeScore" / 10.0), 9)::int AS bin,
                COUNT(*) AS n
           FROM scenario_sessions s
           JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
          WHERE s.tenant_id::text IN ($1, $2)
            AND d."compositeScore" IS NOT NULL
            AND s."startedAt" >= $3 AND s."startedAt" < $4
          GROUP BY 1`,
      [tenantId, tenantCode, start, endExclusive],
    );
    const medianRows: Array<{ median: string | null }> =
      await this.dataSource.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY d."compositeScore") AS median
           FROM scenario_sessions s
           JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
          WHERE s.tenant_id::text IN ($1, $2)
            AND d."compositeScore" IS NOT NULL
            AND s."startedAt" >= $3 AND s."startedAt" < $4`,
        [tenantId, tenantCode, start, endExclusive],
      );
    const bins = Array.from({ length: 10 }, () => 0);
    rows.forEach((r) => {
      bins[Number(r.bin)] = Number(r.n);
    });
    const median = medianRows[0]?.median;
    return {
      bins,
      sessions: bins.reduce((a, b) => a + b, 0),
      median: median == null ? null : Math.round(Number(median)),
    };
  }

  /**
   * For each learner with at least two scored sessions in the window, compares
   * their first with their latest. A change of {@link TREND_THRESHOLD} points
   * or more counts as improving or declining; anything smaller is holding.
   */
  async getLearnerTrendCounts(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
    threshold: number,
  ): Promise<LearnerTrendCounts> {
    const rows: Array<{
      improving: string;
      holding: string;
      declining: string;
    }> = await this.dataSource.query(
      `WITH scored AS (
           SELECT s."counselorId" AS learner, d."compositeScore" AS score, s."startedAt" AS at
             FROM scenario_sessions s
             JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
            WHERE s.tenant_id::text IN ($1, $2)
              AND d."compositeScore" IS NOT NULL
              AND s."startedAt" >= $3 AND s."startedAt" < $4
         ),
         ends AS (
           SELECT learner,
                  COUNT(*) AS n,
                  (ARRAY_AGG(score ORDER BY at ASC))[1] AS first_score,
                  (ARRAY_AGG(score ORDER BY at DESC))[1] AS last_score
             FROM scored GROUP BY learner HAVING COUNT(*) >= 2
         )
         SELECT COUNT(*) FILTER (WHERE last_score - first_score >= $5) AS improving,
                COUNT(*) FILTER (WHERE last_score - first_score <= -$5) AS declining,
                COUNT(*) FILTER (WHERE ABS(last_score - first_score) < $5) AS holding
           FROM ends`,
      [tenantId, tenantCode, start, endExclusive, threshold],
    );
    const r = rows[0];
    return {
      improving: Number(r?.improving ?? 0),
      holding: Number(r?.holding ?? 0),
      declining: Number(r?.declining ?? 0),
    };
  }

  /** Scenarios with at least `minSessions` scored sessions, lowest average first. */
  async getScenarioScores(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
    minSessions: number,
    limit: number,
  ): Promise<ScenarioScoreRow[]> {
    const rows: Array<{
      scenarioId: number;
      title: string;
      averageScore: string;
      sessions: string;
    }> = await this.dataSource.query(
      `SELECT s."scenarioId" AS "scenarioId",
              sc.title AS title,
              AVG(d."compositeScore") AS "averageScore",
              COUNT(*) AS sessions
         FROM scenario_sessions s
         JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
         JOIN scenarios sc ON sc.id = s."scenarioId"
        WHERE s.tenant_id::text IN ($1, $2)
          AND d."compositeScore" IS NOT NULL
          AND s."startedAt" >= $3 AND s."startedAt" < $4
        GROUP BY s."scenarioId", sc.title
       HAVING COUNT(*) >= $5
        ORDER BY AVG(d."compositeScore") ASC
        LIMIT $6`,
      [tenantId, tenantCode, start, endExclusive, minSessions, limit],
    );
    return rows.map((r) => ({
      scenarioId: Number(r.scenarioId),
      title: r.title,
      averageScore: Math.round(Number(r.averageScore)),
      sessions: Number(r.sessions),
    }));
  }

  /** Session ratings (1 to 5 stars) given in the window. Counts only: no comments. */
  async getRatingCounts(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
  ): Promise<RatingCounts> {
    const rows: Array<{ rating: number; n: string }> =
      await this.dataSource.query(
        `SELECT f.rating AS rating, COUNT(*) AS n
           FROM scenario_session_feedbacks f
          WHERE f.tenant_id::text IN ($1, $2)
            AND f.rating BETWEEN 1 AND 5
            AND f."createdAt" >= $3 AND f."createdAt" < $4
          GROUP BY f.rating`,
        [tenantId, tenantCode, start, endExclusive],
      );
    const stars = [0, 0, 0, 0, 0];
    rows.forEach((r) => {
      stars[Number(r.rating) - 1] = Number(r.n);
    });
    const count = stars.reduce((a, b) => a + b, 0);
    const total = stars.reduce((sum, n, i) => sum + n * (i + 1), 0);
    return {
      stars,
      count,
      average: count > 0 ? Math.round((total / count) * 10) / 10 : null,
    };
  }

  /** Completed sessions in the window, and how many of them have been shared for review. */
  async getReviewCoverage(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
  ): Promise<ReviewCoverage> {
    const rows: Array<{ completed: string; reviewed: string }> =
      await this.dataSource.query(
        `SELECT COUNT(*) AS completed,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM scenario_session_reviews r
                   WHERE r."scenarioSessionId" = s.id AND r.status = 'IN_REVIEW'
                )) AS reviewed
           FROM scenario_sessions s
          WHERE s.tenant_id::text IN ($1, $2)
            AND s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
            AND s."startedAt" >= $3 AND s."startedAt" < $4`,
        [tenantId, tenantCode, start, endExclusive],
      );
    return {
      completedSessions: Number(rows[0]?.completed ?? 0),
      reviewedSessions: Number(rows[0]?.reviewed ?? 0),
    };
  }
}
