import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';

/**
 * P0 SEAM — who may see a release plan, click Release, and resume the breaker.
 *
 * Plan §3: Owner holds the platform-wide risky switches; the lead makes an
 * idea's irreversible calls (D4, D11). P0's `RoadmapRoleService` will answer
 * this from roles and capabilities (`can.release`, `can.configure`). Until it
 * is merged, this reads the toggles P0's role mapping is defined from:
 *
 *  - Owner  = `product_roadmap_manage` (P0: `product_roadmap_manage` → owner);
 *  - lead   = the idea's plan session `leadUserId`, holding the Product
 *             Planning — Lead toggle (what `PlanAccessService.canEdit` checks);
 *  - viewer = anyone with Product Roadmap, Lead or Owner.
 *
 * TODO(P0): replace the three checks with `RoadmapRoleService.roleOf` /
 * `capabilitiesFor(user, item).release`. Callers do not change.
 */
@Injectable()
export class ReleasePolicyAccessService {
  constructor(
    private readonly featureToggleService: FeatureToggleService,
    private readonly dataSource: DataSource,
  ) {}

  isOwner(userId: number): Promise<boolean> {
    return this.featureToggleService.hasToggle(
      userId,
      FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
    );
  }

  /** Read a release plan: D2, everyone on the Roadmap sees everything read-only. */
  async canView(userId: number): Promise<boolean> {
    for (const key of [
      FeatureToggleKey.PRODUCT_ROADMAP,
      FeatureToggleKey.PRODUCT_PLANNING_LEAD,
      FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
    ]) {
      if (await this.featureToggleService.hasToggle(userId, key)) return true;
    }
    return false;
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
    return this.featureToggleService.hasToggle(
      userId,
      FeatureToggleKey.PRODUCT_PLANNING_LEAD,
    );
  }
}
