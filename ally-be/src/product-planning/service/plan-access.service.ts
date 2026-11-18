import { ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PLATFORM_WIDE_ONLY_MESSAGE } from 'src/authorization/service/tenant-scope.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { RoadmapRoleService } from './roadmap-role.service';
import { RoadmapRole, roleAtLeast } from '../util/roadmap-role.util';

/** The facts about a plan session that every access rule reads. */
export interface PlanAccessFacts {
  createdBy: number;
  visibility: BuilderSessionVisibility;
  leadUserId?: number | null;
}

const IDEAS_REQUIRED_MESSAGE =
  'Filing ideas needs the Idea role on the Roadmap, which your account does not have. ' +
  'Ask a Roadmap Owner to give you a role on Users.';
const LEAD_REQUIRED_MESSAGE =
  'Leading a plan needs the Builder role on the Roadmap. ' +
  'Ask a Roadmap Owner to give you a role on Users.';

/**
 * Who may do what in the plan flow (plans/roadmap-owns-planning rev 5.2 §B.12),
 * decided by the person's Roadmap role (plans/roadmap-builder-merge §3), not by
 * admin toggles of its own. Roles nest, Owner ⊃ Builder ⊃ Idea:
 *
 *  - Idea (author): park, work up and file an idea;
 *  - Builder (lead): everything after filing — take on, PRD, design, build,
 *    launch, outcome review;
 *  - Owner: both. There is no door onto the board that skips the readiness
 *    check; an idea reaches it only once it is mature enough to submit.
 *
 * Plus one rule no role expresses: an author always reads their own plan.
 * There is no human sign-off role: the lead resolves every review finding,
 * with a recorded reason.
 *
 * Enforced INSIDE services and handlers, not only on routes: plan routes call
 * services written for Builder, which assume EDIT_BUILDER, so a route-level
 * gate alone would leave the service open to its next caller.
 *
 * An org-restricted admin resolves to Viewer at most (RoadmapRoleService), so
 * the whole flow is closed to them without a separate check.
 */
@Injectable()
export class PlanAccessService {
  constructor(private readonly roles: RoadmapRoleService) {}

  private async atLeast(userId: number, floor: RoadmapRole): Promise<boolean> {
    return roleAtLeast(await this.roles.roleOf(userId), floor);
  }

  /** Idea role or above: park, work up or file an idea. */
  canIdeas(userId: number): Promise<boolean> {
    return this.atLeast(userId, 'idea');
  }

  /** Builder role or above: take on an idea and lead it. */
  canLead(userId: number): Promise<boolean> {
    return this.atLeast(userId, 'builder');
  }

  /** Park, work up or file an idea — every filing door calls this. */
  async assertIdeas(userId: number): Promise<void> {
    await this.assertAtLeast(userId, 'idea', IDEAS_REQUIRED_MESSAGE);
  }

  async assertLead(userId: number): Promise<void> {
    await this.assertAtLeast(userId, 'builder', LEAD_REQUIRED_MESSAGE);
  }

  /**
   * Read a plan: its author always (even if their role was later lowered), and
   * any Builder or Owner once it is shared. A private draft is its author's alone.
   */
  async canRead(plan: PlanAccessFacts, userId: number): Promise<boolean> {
    if (plan.createdBy === userId) return true;
    if (plan.visibility === BuilderSessionVisibility.PRIVATE) return false;
    return this.canLead(userId);
  }

  /**
   * Change a plan: while private, its author (with the Idea role); once shared,
   * only its current lead (with the Builder role). A shared plan nobody has
   * taken on is edited by nobody until someone does — the author answers Ask
   * the author, which is not an edit.
   */
  async canEdit(plan: PlanAccessFacts, userId: number): Promise<boolean> {
    if (plan.visibility === BuilderSessionVisibility.PRIVATE) {
      if (plan.createdBy !== userId) return false;
      return this.canIdeas(userId);
    }
    if (!plan.leadUserId || plan.leadUserId !== userId) return false;
    return this.canLead(userId);
  }

  private async assertAtLeast(
    userId: number,
    floor: RoadmapRole,
    message: string,
  ): Promise<void> {
    const role = await this.roles.roleOf(userId);
    if (roleAtLeast(role, floor)) return;
    // A viewer on the roadmap is an org-restricted admin: say why, rather than
    // sending them to ask for a role that cannot help.
    throw this.refusal(
      role === 'viewer' ? PLATFORM_WIDE_ONLY_MESSAGE : message,
    );
  }

  private refusal(message: string): ForbiddenException {
    return new ForbiddenException({
      message,
      error: 'Forbidden',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ErrorCode.FEATURE_NOT_ENABLED,
      featureKey: FeatureToggleKey.PRODUCT_ROADMAP,
    });
  }
}
