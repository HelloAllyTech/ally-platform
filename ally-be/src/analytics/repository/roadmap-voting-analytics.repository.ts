import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';

/** One admin's votes standing in one monthly period. */
export interface RoadmapVotesCastRow {
  userId: number;
  /** 'YYYY-MM', the allocation's own `periodKey`. */
  periodKey: string;
  votes: number;
}

/** Votes ISSUED to one admin for one month — monthly + daily grants, never refunds. */
export interface RoadmapVotesGrantedRow {
  userId: number;
  /** 'YYYY-MM', taken from the grant's own `grantKey`. */
  periodKey: string;
  granted: number;
}

export interface RoadmapVoterRow {
  userId: number;
  name: string | null;
}

/**
 * Who on the team is voting on the internal product roadmap, month by month — the
 * Analytics → Highlights → Priority "Roadmap votes cast" card.
 *
 * Three sources, all raw SQL over tables by name like the sibling
 * `RoadmapDeliveryAnalyticsRepository` (the coupling that note in the roadmap module
 * warns about: rename a column on these tables and grep `src/analytics/` too):
 *
 *  - **`roadmap_allocations`** — votes. A row is one user's votes on one opportunity
 *    in one `periodKey`, and setting votes back to 0 DELETES the row, so a month's
 *    sum is the votes cast in that month that still stand: a vote taken back is not
 *    counted, a vote on an opportunity that has since shipped still is. Split/merge
 *    re-points rows between opportunities but keeps the user and period, so it never
 *    changes a user's monthly total.
 *  - **`roadmap_vote_grants`** — who had votes to cast. The scheduler issues a
 *    monthly and a daily grant to every holder of `vote:admin:product-roadmap`, so a
 *    grant in a month is the record that the admin had access that month. That is
 *    what makes the participation denominator historical rather than "whoever has
 *    access today". Refund grants are excluded: they hand back votes already cast,
 *    so counting them would inflate the votes issued by every vote taken back.
 *  - **the permission itself** — who has access NOW, so an admin added today shows
 *    up as a non-voter before the scheduler's next tick has issued them anything.
 *
 * No tenant: the roadmap tables extend `BaseWithoutTenantEntity` — it is Ally's own
 * backlog — so there is nothing to scope and no `excludeTestTenants`.
 */
@Injectable()
export class RoadmapVotingAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getVotesCast(): Promise<RoadmapVotesCastRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT a."userId"        AS "userId",
             a."periodKey"     AS "periodKey",
             SUM(a.votes)::int AS "votes"
      FROM roadmap_allocations a
      GROUP BY a."userId", a."periodKey"
      `,
    );
    return rows.map((r: Record<string, unknown>) => ({
      userId: Number(r.userId),
      periodKey: r.periodKey as string,
      votes: Number(r.votes) || 0,
    }));
  }

  /**
   * Of each admin's standing votes, how many sit on an opportunity THEY created
   * (`createdBy` is the author). Soft-deleted opportunities are kept in on purpose:
   * the vote still stands in `getVotesCast`, so it must stay in both sides of the
   * "share on colleagues' ideas" ratio.
   */
  async getOwnVotesCast(): Promise<RoadmapVotesCastRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT a."userId"        AS "userId",
             a."periodKey"     AS "periodKey",
             SUM(a.votes)::int AS "votes"
      FROM roadmap_allocations a
      INNER JOIN roadmap_opportunities o ON o.id = a."opportunityId"
      WHERE o."createdBy" = a."userId"
      GROUP BY a."userId", a."periodKey"
      `,
    );
    return rows.map((r: Record<string, unknown>) => ({
      userId: Number(r.userId),
      periodKey: r.periodKey as string,
      votes: Number(r.votes) || 0,
    }));
  }

  /**
   * Bucketed on `grantKey` rather than `grantedAt`: the key IS the period the grant
   * was issued for ('YYYY-MM' monthly, 'YYYY-MM-DD' daily, both UTC — the same clock
   * as `periodKey`), whereas `grantedAt` is when the row was written, which for the
   * backfill migration is a different month from the one it covers.
   */
  async getVotesGranted(): Promise<RoadmapVotesGrantedRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT g."userId"              AS "userId",
             LEFT(g."grantKey", 7)   AS "periodKey",
             SUM(g.amount)::int      AS "granted"
      FROM roadmap_vote_grants g
      WHERE g.source IN ('monthly', 'daily')
        AND g."grantKey" IS NOT NULL
      GROUP BY g."userId", LEFT(g."grantKey", 7)
      `,
    );
    return rows.map((r: Record<string, unknown>) => ({
      userId: Number(r.userId),
      periodKey: r.periodKey as string,
      granted: Number(r.granted) || 0,
    }));
  }

  /** The same query the grant scheduler uses to decide who gets votes. */
  async getEligibleUserIds(): Promise<number[]> {
    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT ug."userId" AS "userId"
      FROM user_groups ug
      INNER JOIN group_permissions gp ON gp."groupId" = ug."groupId"
      INNER JOIN permissions p        ON p.id = gp."permissionId"
      WHERE p.name = $1
      `,
      [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
    );
    return rows.map((r: Record<string, unknown>) => Number(r.userId));
  }

  async getUserNames(userIds: number[]): Promise<RoadmapVoterRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `SELECT u.id AS "userId", u.name AS "name" FROM users u WHERE u.id = ANY($1::int[])`,
      [userIds],
    );
    return rows.map((r: Record<string, unknown>) => ({
      userId: Number(r.userId),
      name: (r.name as string | null)?.trim() || null,
    }));
  }
}
