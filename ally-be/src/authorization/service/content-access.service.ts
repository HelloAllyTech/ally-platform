import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { FeatureToggleKey } from '../constants/admin-feature-toggle.constants';
import { FeatureToggleService } from './feature-toggle.service';

/** The four kinds of library content Simulation Studio authors. */
export enum AuthoredContentType {
  ROLEPLAY = 'roleplay',
  TRACK = 'track',
  CASE = 'case',
  COURSE = 'course',
}

/**
 * The toggle that makes a type writable. Tracks have none: their create screen
 * is being retired, so they are governed by visibility alone.
 */
const AUTHORING_TOGGLE: Partial<Record<AuthoredContentType, FeatureToggleKey>> =
  {
    [AuthoredContentType.ROLEPLAY]: FeatureToggleKey.CREATE_ROLEPLAYS,
    [AuthoredContentType.CASE]: FeatureToggleKey.CREATE_CASES,
    [AuthoredContentType.COURSE]: FeatureToggleKey.CREATE_COURSES,
  };

const PLURAL: Record<AuthoredContentType, string> = {
  [AuthoredContentType.ROLEPLAY]: 'roleplays',
  [AuthoredContentType.TRACK]: 'tracks',
  [AuthoredContentType.CASE]: 'cases',
  [AuthoredContentType.COURSE]: 'courses',
};

/** Each type's table — every one carries a nullable integer `createdBy`. */
const TABLE: Record<AuthoredContentType, string> = {
  [AuthoredContentType.ROLEPLAY]: 'scenarios',
  [AuthoredContentType.TRACK]: 'scenario_paths',
  [AuthoredContentType.CASE]: 'cases',
  [AuthoredContentType.COURSE]: 'tracks',
};

const TOGGLE_LABEL: Record<AuthoredContentType, string> = {
  [AuthoredContentType.ROLEPLAY]: 'Create Roleplays',
  [AuthoredContentType.TRACK]: '',
  [AuthoredContentType.CASE]: 'Create Cases',
  [AuthoredContentType.COURSE]: 'Create Courses',
};

/**
 * ContentAccessService
 * --------------------
 * Who may see and who may author library content, per platform admin:
 *
 *   - CONTENT_VIEW_ALL off → they see, open and pick only what they created
 *     (`createdBy`). Content with no recorded creator is nobody's, so it is
 *     hidden from them too.
 *   - CREATE_<TYPE> off → that type is view-only: no create, duplicate, edit
 *     or delete.
 *
 * Only platform-tier admins are subject to either. A tenant ADMIN calls the
 * same list endpoints from the helpline dashboard, and a service-to-service
 * call carries no user; both pass through untouched. The organization-
 * allowlist rules for restricted admins (TenantScopeService) are separate and
 * still apply on top.
 *
 * `userId` defaults to the caller in ExecutionManager — which Course Copilot
 * sets to the session's owner while it builds, so Copilot is held to its
 * owner's toggles.
 */
@Injectable()
export class ContentAccessService {
  constructor(
    private readonly featureToggleService: FeatureToggleService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The creator id this caller's content reads must be narrowed to, or `null`
   * when they see everything.
   */
  async ownerFilterFor(userId = currentUserId()): Promise<number | null> {
    if (!userId) return null;
    if (!(await this.featureToggleService.isPlatformTierAdmin(userId))) {
      return null;
    }
    const seesAll = await this.featureToggleService.hasToggle(
      userId,
      FeatureToggleKey.CONTENT_VIEW_ALL,
    );
    return seesAll ? null : userId;
  }

  async canSee(
    createdBy: number | null | undefined,
    userId = currentUserId(),
  ): Promise<boolean> {
    const ownerId = await this.ownerFilterFor(userId);
    return ownerId === null || Number(createdBy) === ownerId;
  }

  /**
   * Refuse to open content outside the caller's view. Forbidden rather than
   * not-found, so an admin following a colleague's link learns why — the same
   * choice TenantScopeService makes for organizations.
   */
  async assertCanSee(
    type: AuthoredContentType,
    createdBy: number | null | undefined,
    userId = currentUserId(),
  ): Promise<void> {
    if (await this.canSee(createdBy, userId)) return;
    throw new ForbiddenException(
      `You can only open ${PLURAL[type]} you created. ` +
        'Ask whoever manages admin access to turn on See All Content for you.',
    );
  }

  async canAuthor(
    type: AuthoredContentType,
    userId = currentUserId(),
  ): Promise<boolean> {
    const toggle = AUTHORING_TOGGLE[type];
    if (!toggle || !userId) return true;
    if (!(await this.featureToggleService.isPlatformTierAdmin(userId))) {
      return true;
    }
    return this.featureToggleService.hasToggle(userId, toggle);
  }

  /** Refuse a create, duplicate, edit or delete of a type that is view-only for the caller. */
  async assertCanAuthor(
    type: AuthoredContentType,
    userId = currentUserId(),
  ): Promise<void> {
    if (await this.canAuthor(type, userId)) return;
    throw new ForbiddenException(
      `You can view ${PLURAL[type]} but not create or change them. ` +
        `Ask whoever manages admin access to turn on ${TOGGLE_LABEL[type]} for you.`,
    );
  }

  /**
   * Refuse a batch of ids unless every one is in the caller's view — for the
   * organization assignment routes, which take ids straight from the body.
   * Ids that don't exist are left to the caller's own validation.
   */
  async assertAllInView(
    type: AuthoredContentType,
    ids: (string | number)[] | undefined,
    userId = currentUserId(),
  ): Promise<void> {
    if (!ids?.length) return;
    const ownerId = await this.ownerFilterFor(userId);
    if (ownerId === null) return;
    const [{ outside }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS outside FROM "${TABLE[type]}"
        WHERE id = ANY($1) AND "createdBy" IS DISTINCT FROM $2`,
      [ids, ownerId],
    );
    if (outside === 0) return;
    throw new ForbiddenException(
      `You can only add or remove ${PLURAL[type]} you created. ` +
        'Ask whoever manages admin access to turn on See All Content for you.',
    );
  }

  /** Both checks, for changing one existing item: the type is writable and the item is in view. */
  async assertCanModify(
    type: AuthoredContentType,
    createdBy: number | null | undefined,
    userId = currentUserId(),
  ): Promise<void> {
    await this.assertCanAuthor(type, userId);
    await this.assertCanSee(type, createdBy, userId);
  }
}

function currentUserId(): number | undefined {
  const userId = ExecutionManager.getUserId();
  return userId ? Number(userId) : undefined;
}
