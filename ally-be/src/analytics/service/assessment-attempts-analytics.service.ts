import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AssessmentAttemptsWeek {
  /** ISO date of the UTC week start (Monday). */
  week: string;
  /** Learner × assessment item units whose first valid attempt fell this week. */
  units: number;
  /** Of those, units with exactly one valid attempt and no trainer reopen. */
  singleValid: number;
  /** singleValid / units, 0–1; null with no units. */
  share: number | null;
  /** Attempts ended below the minimum learner turns, by week they ended. */
  incompleteStarts: number;
}

export interface AssessmentAttemptsResponse {
  totals: {
    units: number;
    singleValid: number;
    share: number | null;
    incompleteStarts: number;
    /** Incomplete starts per unit with a valid attempt. */
    incompleteStartsPerUnit: number | null;
  };
  weeks: AssessmentAttemptsWeek[];
}

/**
 * AAQ-255: the success metric for assessment roleplays in courses. The unit is
 * a learner on an assessment item who has at least one valid attempt (a
 * session stamped `assessmentAttemptValid` when it ended). The metric is the
 * share of those units with exactly one valid attempt and no trainer reopen —
 * "a single, credible attempt". Incomplete starts (attempts that ended below
 * the minimum turns) travel alongside and are never subtracted.
 *
 * Platform-wide, all-time, weekly by the unit's first valid attempt. Sessions
 * before the min-turns release were backfilled as valid at one learner turn,
 * the rule they were played under, so early weeks use that weaker definition.
 */
@Injectable()
export class AssessmentAttemptsAnalyticsService {
  constructor(private readonly dataSource: DataSource) {}

  async getAssessmentAttempts(): Promise<AssessmentAttemptsResponse> {
    const unitRows: Array<{
      week: string;
      units: number;
      singleValid: number;
    }> = await this.dataSource.query(
      `WITH units AS (
         SELECT s."trackItemProgressId" AS id,
                MIN(COALESCE(s."endedAt", s."updatedAt")) AS "firstValidAt",
                COUNT(*)::int AS "validCount"
           FROM scenario_sessions s
          WHERE s."assessmentAttemptValid" IS TRUE
            AND s."trackItemProgressId" IS NOT NULL
          GROUP BY s."trackItemProgressId"
       )
       SELECT to_char(date_trunc('week', u."firstValidAt"), 'YYYY-MM-DD') AS "week",
              COUNT(*)::int AS "units",
              COUNT(*) FILTER (
                WHERE u."validCount" = 1
                  AND tip.meta->>'assessmentReopenedAt' IS NULL
              )::int AS "singleValid"
         FROM units u
         JOIN track_item_progress tip ON tip.id = u.id
        GROUP BY 1
        ORDER BY 1`,
    );
    const incompleteRows: Array<{ week: string; incompleteStarts: number }> =
      await this.dataSource.query(
        `SELECT to_char(date_trunc('week', COALESCE(s."endedAt", s."updatedAt")), 'YYYY-MM-DD') AS "week",
                COUNT(*)::int AS "incompleteStarts"
           FROM scenario_sessions s
          WHERE s."assessmentAttemptValid" IS FALSE
            AND s."learnerTurns" > 0
          GROUP BY 1
          ORDER BY 1`,
      );

    const weeks = new Map<string, AssessmentAttemptsWeek>();
    const weekOf = (week: string) => {
      const existing = weeks.get(week);
      if (existing) return existing;
      const created: AssessmentAttemptsWeek = {
        week,
        units: 0,
        singleValid: 0,
        share: null,
        incompleteStarts: 0,
      };
      weeks.set(week, created);
      return created;
    };
    for (const row of unitRows) {
      const week = weekOf(row.week);
      week.units = Number(row.units);
      week.singleValid = Number(row.singleValid);
    }
    for (const row of incompleteRows) {
      weekOf(row.week).incompleteStarts = Number(row.incompleteStarts);
    }
    const ordered = Array.from(weeks.values()).sort((a, b) =>
      a.week.localeCompare(b.week),
    );
    for (const week of ordered) {
      week.share = week.units > 0 ? week.singleValid / week.units : null;
    }
    const units = ordered.reduce((sum, w) => sum + w.units, 0);
    const singleValid = ordered.reduce((sum, w) => sum + w.singleValid, 0);
    const incompleteStarts = ordered.reduce(
      (sum, w) => sum + w.incompleteStarts,
      0,
    );
    return {
      totals: {
        units,
        singleValid,
        share: units > 0 ? singleValid / units : null,
        incompleteStarts,
        incompleteStartsPerUnit: units > 0 ? incompleteStarts / units : null,
      },
      weeks: ordered,
    };
  }
}
