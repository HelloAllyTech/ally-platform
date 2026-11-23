import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const SCOPE_KINDS = ['course', 'simulation', 'learner'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export interface ScopeOption {
  /** A course uuid, or a simulation or learner id as text. */
  id: string;
  label: string;
}

/**
 * What a chart can be drawn for: the courses the tenant has, the simulations
 * its learners have practised, and its learners. For the scope selector on a
 * chart. A learner's name is already shown to the same admin in the learner
 * table, so the label is no wider than what they can see today. The search is
 * passed as a parameter and the list is capped.
 */
@Injectable()
export class TenantScopeOptionsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    kind: ScopeKind,
    tenantId: string,
    tenantCode: string,
    search: string | undefined,
    limit: number,
  ): Promise<ScopeOption[]> {
    const like = `%${(search ?? '').replace(/[\\%_]/g, '\\$&')}%`;
    const cap = Math.max(1, Math.min(100, Math.floor(limit)));
    if (kind === 'course') {
      const rows: Array<{ id: string; label: string }> =
        await this.dataSource.query(
          `SELECT t.id::text AS id, t.title AS label
             FROM tracks t
             JOIN track_tenants tt
               ON tt."trackId" = t.id AND tt."tenantId"::text = $1 AND tt."deletedAt" IS NULL
            WHERE t."deletedAt" IS NULL AND t.status IN ('ACTIVE', 'ARCHIVED')
              AND t.title ILIKE $2
            ORDER BY t.title
            LIMIT ${cap}`,
          [tenantId, like],
        );
      return rows;
    }
    if (kind === 'simulation') {
      const rows: Array<{ id: string; label: string }> =
        await this.dataSource.query(
          `SELECT sc.id::text AS id, sc.title AS label
             FROM scenarios sc
             JOIN scenario_sessions s ON s."scenarioId" = sc.id
            WHERE s.tenant_id::text IN ($1, $2)
              AND sc.title ILIKE $3
            GROUP BY sc.id, sc.title
            ORDER BY COUNT(*) DESC, sc.title
            LIMIT ${cap}`,
          [tenantId, tenantCode, like],
        );
      return rows;
    }
    const rows: Array<{ id: string; label: string }> =
      await this.dataSource.query(
        `SELECT u.id::text AS id, COALESCE(NULLIF(u.name, ''), u.email) AS label
           FROM users u
          WHERE u."tenant_id" = $1
            AND u.status != 'SUSPENDED'
            AND EXISTS (
                  SELECT 1 FROM user_groups ug
                  JOIN groups g ON g.id = ug."groupId"
                  WHERE ug."userId" = u.id AND g.name = 'LEARNER'
                )
            AND (u.name ILIKE $2 OR u.email ILIKE $2)
          ORDER BY label
          LIMIT ${cap}`,
        [tenantId, like],
      );
    return rows;
  }

  /**
   * The name of one course, simulation or learner, or null when the tenant has
   * no such thing. Also the ownership check: an id from another organisation
   * finds nothing.
   */
  async describe(
    kind: ScopeKind,
    id: string | number,
    tenantId: string,
    tenantCode: string,
  ): Promise<string | null> {
    const rows: Array<{ label: string | null }> = await this.dataSource.query(
      kind === 'course'
        ? `SELECT t.title AS label
             FROM tracks t
             JOIN track_tenants tt
               ON tt."trackId" = t.id AND tt."tenantId"::text = $1 AND tt."deletedAt" IS NULL
            WHERE t.id = $2::uuid AND t."deletedAt" IS NULL`
        : kind === 'simulation'
          ? `SELECT sc.title AS label
               FROM scenarios sc
              WHERE sc.id = $2::int
                AND EXISTS (
                  SELECT 1 FROM scenario_sessions s
                   WHERE s."scenarioId" = sc.id AND s.tenant_id::text IN ($1, $3)
                )`
          : `SELECT COALESCE(NULLIF(u.name, ''), u.email) AS label
               FROM users u
              WHERE u.id = $2::int AND u."tenant_id" = $1`,
      kind === 'simulation'
        ? [tenantId, String(id), tenantCode]
        : [tenantId, String(id)],
    );
    return rows[0]?.label ?? null;
  }
}
