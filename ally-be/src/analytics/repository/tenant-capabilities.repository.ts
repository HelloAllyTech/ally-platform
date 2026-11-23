import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { STATISTICS_DASHBOARD_SETTINGS_KEY } from '../constants/tenant-chart-library.constants';
import { TenantCapabilities } from '../util/tenant-chart-library.util';

export interface TenantStatisticsKeys {
  /** The tenant's short code, the second spelling its varchar tenant columns may hold. */
  code: string;
  /** `tenants.settings.statisticsDashboard.enabled === true` */
  statisticsDashboardEnabled: boolean;
}

/**
 * Cheap per-tenant counts that decide which library charts an organisation can
 * fill (see `tenant-chart-library.constants.ts`).
 *
 * Read-only aggregates, no row-level data. Several tables store the tenant as a
 * VARCHAR holding either the tenant uuid or its code, and others as a uuid, so
 * every match goes through `IN ($1, $2)` on `::text` with the uuid and the code.
 *
 * Score-based signals count sessions that have a judged composite score
 * (`scenario_session_details.compositeScore`, 0 to 100). That is the score the
 * score charts show: it is on one scale across scenarios and comparable between
 * sessions. `scenario_sessions.score` is a running points total (prod ranges
 * from about -210 to over 1,000) that differs by scenario, so it cannot be
 * averaged or compared. The tenant analytics page is an analytics surface, where
 * the composite is allowed.
 */
@Injectable()
export class TenantCapabilitiesRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The tenant's code and whether the new Statistics page is on for it. */
  async getTenantKeys(tenantId: string): Promise<TenantStatisticsKeys | null> {
    const rows: Array<{ code: string; enabled: boolean }> =
      await this.dataSource.query(
        `SELECT code,
                COALESCE(settings->'${STATISTICS_DASHBOARD_SETTINGS_KEY}'->>'enabled', 'false') = 'true' AS enabled
           FROM tenants
          WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [tenantId],
      );
    if (!rows[0]) return null;
    return {
      code: rows[0].code,
      statisticsDashboardEnabled: rows[0].enabled === true,
    };
  }

  async getCapabilities(
    tenantId: string,
    tenantCode: string,
  ): Promise<TenantCapabilities> {
    const rows: Array<Record<string, string | number | null>> =
      await this.dataSource.query(
        `SELECT
          (SELECT COUNT(DISTINCT u.id)
             FROM users u
             JOIN user_groups ug ON ug."userId" = u.id
             JOIN groups g ON g.id = ug."groupId" AND g.name = 'LEARNER'
            WHERE u.tenant_id::text IN ($1, $2)) AS "learners",
          (SELECT COUNT(DISTINCT s."counselorId")
             FROM scenario_sessions s
            WHERE s.tenant_id::text IN ($1, $2)
              AND s."startedAt" > now() - interval '90 days') AS "activeLearners90",
          (SELECT COUNT(*)
             FROM scenario_sessions s
            WHERE s.tenant_id::text IN ($1, $2)
              AND s."startedAt" > now() - interval '90 days') AS "sessions90",
          (SELECT COUNT(*)
             FROM scenario_sessions s
             JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
            WHERE s.tenant_id::text IN ($1, $2)
              AND d."compositeScore" IS NOT NULL
              AND s."startedAt" > now() - interval '90 days') AS "scoredSessions90",
          (SELECT COUNT(*) FROM (
             SELECT s."counselorId"
               FROM scenario_sessions s
               JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
              WHERE s.tenant_id::text IN ($1, $2) AND d."compositeScore" IS NOT NULL
              GROUP BY s."counselorId"
             HAVING COUNT(*) >= 2) rep) AS "learnersWithRepeatScoredSessions",
          (SELECT COUNT(*)
             FROM scenario_session_feedbacks f
            WHERE f.tenant_id::text IN ($1, $2)) AS "ratings",
          (SELECT COUNT(DISTINCT date_trunc('week', s."startedAt"))
             FROM scenario_sessions s
            WHERE s.tenant_id::text IN ($1, $2)
              AND s."startedAt" > now() - interval '90 days') AS "weeksWithActivity90",
          (SELECT COUNT(*)
             FROM track_enrollments e
            WHERE e."tenantId"::text IN ($1, $2) AND e."deletedAt" IS NULL) AS "courseEnrolments",
          (SELECT COUNT(*)
             FROM track_enrollments e
            WHERE e."tenantId"::text IN ($1, $2)
              AND e."deletedAt" IS NULL AND e."completedAt" IS NOT NULL) AS "courseCompletions",
          (SELECT COUNT(*)
             FROM track_item_progress p
             JOIN track_enrollments e ON e.id = p."trackEnrollmentId"
            WHERE e."tenantId"::text IN ($1, $2)
              AND p."deletedAt" IS NULL AND p.score IS NOT NULL) AS "scoredQuizItems",
          (SELECT COUNT(*)
             FROM scenario_session_reviews r
            WHERE r.tenant_id::text IN ($1, $2)) AS "reviews",
          (SELECT COUNT(*)
             FROM tenant_cohorts c
            WHERE c."tenantId"::text IN ($1, $2) AND c."deletedAt" IS NULL) AS "cohorts",
          (SELECT COUNT(*)
             FROM foundational_skill_cuts c
             JOIN foundational_skill_assessments a ON a."cutId" = c.id
            WHERE c.tenant_id::text IN ($1, $2) AND a."compositeScore" IS NOT NULL) AS "skillScoredCuts",
          (SELECT COUNT(DISTINCT c."userId")
             FROM foundational_skill_cuts c
             JOIN foundational_skill_assessments a ON a."cutId" = c.id
            WHERE c.tenant_id::text IN ($1, $2) AND a."compositeScore" IS NOT NULL) AS "skillScoredLearners"`,
        [tenantId, tenantCode],
      );

    const row = rows[0] ?? {};
    const n = (key: string): number => Number(row[key] ?? 0);
    return {
      learners: n('learners'),
      activeLearners90: n('activeLearners90'),
      sessions90: n('sessions90'),
      scoredSessions90: n('scoredSessions90'),
      learnersWithRepeatScoredSessions: n('learnersWithRepeatScoredSessions'),
      ratings: n('ratings'),
      weeksWithActivity90: n('weeksWithActivity90'),
      courseEnrolments: n('courseEnrolments'),
      courseCompletions: n('courseCompletions'),
      scoredQuizItems: n('scoredQuizItems'),
      reviews: n('reviews'),
      cohorts: n('cohorts'),
      skillScoredCuts: n('skillScoredCuts'),
      skillScoredLearners: n('skillScoredLearners'),
    };
  }
}
