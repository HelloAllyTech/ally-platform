import { ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { PLATFORM_WIDE_ONLY_MESSAGE } from 'src/authorization/service/tenant-scope.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { PlanSignOffKind } from '../enum/product-planning.enum';

/** The facts about a plan session that every access rule reads. */
export interface PlanAccessFacts {
  createdBy: number;
  visibility: BuilderSessionVisibility;
  leadUserId?: number | null;
}

const IDEAS_REQUIRED_MESSAGE =
  'Filing ideas needs the Product Planning — Ideas toggle, which is off for your account. ' +
  'Ask whoever manages admin access to switch it on.';
const LEAD_REQUIRED_MESSAGE =
  'Leading a plan needs the Product Planning — Lead toggle. ' +
  'Ask whoever manages admin access to grant it.';

/**
 * Who may do what in the plan flow (plans/roadmap-owns-planning rev 5.1 §B.12).
 *
 * Two admin toggles decide it — Ideas (author: park, work up, file) and Lead
 * (everything after filing) — plus two rules no toggle expresses: an author
 * always reads their own plan, and a high-severity sign-off belongs to a
 * NAMED person (builder_settings.plan*ReviewerIds), never to a Lead.
 *
 * Enforced INSIDE services and handlers, not only on routes: plan routes call
 * services written for Builder, which assume EDIT_BUILDER, so a route-level
 * gate alone would leave the service open to its next caller.
 *
 * Org-restricted admins are excluded from both: Lead is platformOnly (so
 * hasToggle already answers false for them), and Ideas — default-on, so not
 * platformOnly — is checked against the restriction in canIdeas.
 */
@Injectable()
export class PlanAccessService {
  constructor(
    private readonly featureToggleService: FeatureToggleService,
    @InjectRepository(BuilderSettings)
    private readonly settingsRepository: Repository<BuilderSettings>,
  ) {}

  /**
   * Ideas is default-on and deliberately NOT platformOnly (see its definition),
   * so the org-restriction is checked here, on planning paths only.
   */
  async canIdeas(userId: number): Promise<boolean> {
    const held = await this.featureToggleService.hasToggle(
      userId,
      FeatureToggleKey.PRODUCT_PLANNING_IDEAS,
    );
    return held && !(await this.featureToggleService.isRestricted(userId));
  }

  canLead(userId: number): Promise<boolean> {
    return this.featureToggleService.hasToggle(
      userId,
      FeatureToggleKey.PRODUCT_PLANNING_LEAD,
    );
  }

  /** Park, work up or file an idea — every filing door calls this. */
  async assertIdeas(userId: number): Promise<void> {
    if (await this.canIdeas(userId)) return;
    const restricted = await this.featureToggleService.isRestricted(userId);
    throw this.refusal(
      restricted ? PLATFORM_WIDE_ONLY_MESSAGE : IDEAS_REQUIRED_MESSAGE,
      FeatureToggleKey.PRODUCT_PLANNING_IDEAS,
    );
  }

  async assertLead(userId: number): Promise<void> {
    await this.assertToggle(
      userId,
      FeatureToggleKey.PRODUCT_PLANNING_LEAD,
      LEAD_REQUIRED_MESSAGE,
    );
  }

  /**
   * Read a plan: its author always (even with Ideas later switched off), and
   * any Lead once it is shared. A private draft is its author's alone.
   */
  async canRead(plan: PlanAccessFacts, userId: number): Promise<boolean> {
    if (plan.createdBy === userId) return true;
    if (plan.visibility === BuilderSessionVisibility.PRIVATE) return false;
    return this.canLead(userId);
  }

  /**
   * Change a plan: while private, its author (with Ideas); once shared, only
   * its current lead (with Lead). A shared plan nobody has taken on is edited
   * by nobody until someone does — the author answers Ask the author, which is
   * not an edit.
   */
  async canEdit(plan: PlanAccessFacts, userId: number): Promise<boolean> {
    if (plan.visibility === BuilderSessionVisibility.PRIVATE) {
      if (plan.createdBy !== userId) return false;
      return this.canIdeas(userId);
    }
    if (!plan.leadUserId || plan.leadUserId !== userId) return false;
    return this.canLead(userId);
  }

  /** Whether this person is named for this sign-off in Builder settings. */
  async isNamedReviewer(
    userId: number,
    kind: PlanSignOffKind,
  ): Promise<boolean> {
    const settings = await this.settingsRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!settings) return false;
    const ids =
      kind === PlanSignOffKind.CLINICAL
        ? settings.planClinicalReviewerIds
        : settings.planPrivacyReviewerIds;
    return Array.isArray(ids) && ids.map(Number).includes(userId);
  }

  private async assertToggle(
    userId: number,
    key: FeatureToggleKey,
    message: string,
  ): Promise<void> {
    if (await this.featureToggleService.hasToggle(userId, key)) return;
    const withheld = await this.featureToggleService.isWithheld(userId, key);
    throw this.refusal(withheld ? PLATFORM_WIDE_ONLY_MESSAGE : message, key);
  }

  private refusal(message: string, key: FeatureToggleKey): ForbiddenException {
    return new ForbiddenException({
      message,
      error: 'Forbidden',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ErrorCode.FEATURE_NOT_ENABLED,
      featureKey: key,
    });
  }
}
