import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';

/**
 * Who may see a release plan, click Release, and resume the breaker.
 *
 * Plan §3: Owner holds the platform-wide risky switches; the lead makes an
 * idea's irreversible calls (D4, D11). Answered from the Roadmap role
 * (`RoadmapRoleService`):
 *
 *  - Owner  = the Owner role;
 *  - lead   = the idea's plan session `leadUserId`, holding the Builder role
 *             (what `PlanAccessService.canEdit` checks);
 *  - viewer = anyone with a Roadmap role, including a Viewer.
 */
@Injectable()
export class ReleasePolicyAccessService {
  constructor(
    private readonly roles: RoadmapRoleService,
    private readonly dataSource: DataSource,
  ) {}

  async isOwner(userId: number): Promise<boolean> {
    return (await this.roles.roleOf(userId)) === 'owner';
  }

  /** Read a release plan: D2, everyone on the Roadmap sees everything read-only. */
  async canView(userId: number): Promise<boolean> {
    return (await this.roles.roleOf(userId)) !== 'none';
  }

  /**
   * Click Release: an Owner, or the lead of any idea whose commits are in the
   * range (plan §5.5.1: "the click is offered on every idea in the range").
   */
  async canRelease(userId: number, opportunityIds: string[]): Promise<boolean> {
    if (await this.isOwner(userId)) return true;
    if (!opportunityIds.length) return false;
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1
         FROM "roadmap_opportunities" opp
         JOIN "builder_sessions" session ON session.id = opp."builderSessionId"
        WHERE opp.id = ANY($1::uuid[])
          AND opp."deletedAt" IS NULL
          AND session."deletedAt" IS NULL
          AND session.kind = 'plan'
          AND session."leadUserId" = $2
        LIMIT 1`,
      [opportunityIds, userId],
    );
    if (!rows.length) return false;
    return roleAtLeast(await this.roles.roleOf(userId), 'builder');
  }
}
