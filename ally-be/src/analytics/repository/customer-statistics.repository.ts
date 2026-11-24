import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants } from '../util/test-tenant.util';

/** The numbers the customer reasons need that Organisation health does not carry. */
export interface CustomerExtras {
  tenantId: string;
  /** Learners who have never completed a session. */
  neverStartedLearners: number;
  /** Completed sessions in the last 28 days, and how many of them were reviewed. */
  completedLast28d: number;
  reviewedLast28d: number;
  /** Learner ratings (1 to 5) over the last 90 days. */
  ratingsCount90d: number;
  ratingsAverage90d: number | null;
}

export interface CustomerContact {
  tenantId: string;
  at: Date;
  note: string | null;
}

/**
 * Reads behind the Customers tab on Statistics, for Ally staff. Aggregates only:
 * a count, a share or an average per organisation, never a name, an email or
 * what a learner said. Live, non-test organisations only (the shared
 * {@link excludeTestTenants} rule).
 *
 * Like its siblings, the tenant columns on sessions and feedback are VARCHAR
 * holding either the tenant uuid or its code, so both spellings are matched.
 */
@Injectable()
export class CustomerStatisticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** For every organisation in one pass; the service picks the ones a caller may see. */
  async getExtras(
    last28Start: Date,
    last90Start: Date,
  ): Promise<CustomerExtras[]> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `
      WITH orgs AS (
        SELECT t.id, t.code
          FROM tenants t
         WHERE t."deletedAt" IS NULL
           AND ${excludeTestTenants('t.id')}
      ),
      learners AS (
        SELECT o.id AS tenant_id, u.id AS user_id
          FROM orgs o
          JOIN users u ON (u."tenant_id" = o.id::text OR u."tenant_id" = o.code)
         WHERE EXISTS (
                 SELECT 1 FROM user_groups ug
                   JOIN groups g ON g.id = ug."groupId"
                  WHERE ug."userId" = u.id AND g.name = $1
               )
      ),
      started AS (
        SELECT DISTINCT l.tenant_id, l.user_id
          FROM learners l
          JOIN scenario_sessions s ON s."counselorId" = l.user_id
         WHERE s."eventStatus" = $2 AND ${countableSessionPredicate('s')}
      ),
      never AS (
        SELECT l.tenant_id, COUNT(*)::int AS n
          FROM learners l
          LEFT JOIN started st ON st.tenant_id = l.tenant_id AND st.user_id = l.user_id
         WHERE st.user_id IS NULL
         GROUP BY l.tenant_id
      ),
      reviews AS (
        SELECT o.id AS tenant_id,
               COUNT(*)::int AS completed,
               COUNT(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM scenario_session_reviews r
                  WHERE r."scenarioSessionId" = s.id AND r.status = 'IN_REVIEW'
               ))::int AS reviewed
          FROM orgs o
          JOIN scenario_sessions s ON (s."tenant_id" = o.id::text OR s."tenant_id" = o.code)
         WHERE s."eventStatus" = $2 AND ${countableSessionPredicate('s')}
           AND COALESCE(s."endedAt", s."createdAt") >= $3
         GROUP BY o.id
      ),
      ratings AS (
        SELECT o.id AS tenant_id, COUNT(*)::int AS n, AVG(f.rating)::float AS average
          FROM orgs o
          JOIN scenario_session_feedbacks f
            ON (f."tenant_id"::text = o.id::text OR f."tenant_id"::text = o.code)
         WHERE f.rating BETWEEN 1 AND 5 AND f."createdAt" >= $4
         GROUP BY o.id
      )
      SELECT o.id::text AS "tenantId",
             COALESCE(n.n, 0)         AS "neverStartedLearners",
             COALESCE(r.completed, 0) AS "completedLast28d",
             COALESCE(r.reviewed, 0)  AS "reviewedLast28d",
             COALESCE(g.n, 0)         AS "ratingsCount90d",
             g.average                AS "ratingsAverage90d"
        FROM orgs o
        LEFT JOIN never n   ON n.tenant_id = o.id
        LEFT JOIN reviews r ON r.tenant_id = o.id
        LEFT JOIN ratings g ON g.tenant_id = o.id
      `,
      [
        UserRole.LEARNER,
        ScenarioSessionEventStatus.COMPLETED,
        last28Start,
        last90Start,
      ],
    );
    return rows.map((r) => ({
      tenantId: String(r.tenantId),
      neverStartedLearners: Number(r.neverStartedLearners) || 0,
      completedLast28d: Number(r.completedLast28d) || 0,
      reviewedLast28d: Number(r.reviewedLast28d) || 0,
      ratingsCount90d: Number(r.ratingsCount90d) || 0,
      ratingsAverage90d:
        r.ratingsAverage90d === null || r.ratingsAverage90d === undefined
          ? null
          : Number(r.ratingsAverage90d),
    }));
  }

  /** When each organisation was last contacted, and the note left, for the organisations given. */
  async latestContacts(
    tenantIds: readonly string[],
  ): Promise<Map<string, CustomerContact>> {
    if (tenantIds.length === 0) return new Map();
    const rows: Array<{ tenantId: string; at: Date; note: string | null }> =
      await this.dataSource.query(
        `SELECT DISTINCT ON ("tenantId") "tenantId"::text AS "tenantId", "createdAt" AS at, "note"
           FROM customer_outreach_log
          WHERE "tenantId"::text = ANY($1)
          ORDER BY "tenantId", "createdAt" DESC`,
        [[...tenantIds]],
      );
    return new Map(
      rows.map((r) => [
        r.tenantId,
        { tenantId: r.tenantId, at: new Date(r.at), note: r.note },
      ]),
    );
  }

  /** Records that a member of staff got in touch with an organisation. */
  async addContact(
    tenantId: string,
    userId: number,
    note: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO customer_outreach_log ("tenantId", "userId", "note")
       VALUES ($1::uuid, $2::int, $3::varchar)`,
      [tenantId, userId, note],
    );
  }
}
