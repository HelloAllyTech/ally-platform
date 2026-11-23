import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../guards/permissions.guard';
import { FeatureToggleGuard } from '../guards/feature-toggle.guard';
import { RequirePermissions } from './permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PreferenceName } from 'src/common/constants/user.constants';

export const FEATURE_TOGGLE_KEY = 'feature-toggle';

export interface FeatureToggleOptions {
  featureKey: FeatureToggleKey;
  /**
   * Org-level escape hatch: a caller whose *tenant* has this preference switched
   * on also passes, without a per-user toggle row. This is how a surface built
   * for platform admins is opened to a tenant's own admins — `admin_feature_toggles`
   * only ever has rows for PLATFORM_ADMIN accounts, so without this a tenant
   * admin holding the right permission would still 403.
   *
   * Permanent, not a rollout window. It never widens *what* the caller may do:
   * PermissionsGuard has already run, so the per-role permission set still
   * decides read vs. write.
   */
  tenantPreference?: PreferenceName;
  /**
   * Own-org escape hatch: a caller holding this permission passes without a
   * toggle row, for a surface that acts on the caller's own organization
   * only. Pair it with `operator: 'OR'` so PermissionsGuard admits the
   * holder, and with a scope check in the handler — this never widens WHICH
   * organization the caller may touch, only who may reach the route. Unlike
   * `tenantPreference` the org-level gate is the service's own (branding:
   * the org's switch), so the refusal can name the fix.
   */
  orgAdminPermission?: string;
  /**
   * A second toggle that also opens the route, for a caller who lacks the
   * first. Used on Builder's `:sessionId` routes so a Product Planning Lead can
   * work a plan's PRD, design and build without the Builder toggle. The guard
   * marks such a caller (`request.viaAlternateToggle`) so the route's own
   * scope check can confine them — BuilderSessionVisibilityInterceptor lets
   * them reach plan sessions only.
   */
  alsoAllowedBy?: FeatureToggleKey;
}

/**
 * @RequireFeatureToggle(key, options?)
 *
 * Combined decorator for the ~21 surfaces formerly gated by
 * @AuthRoles(SUPER_ADMIN_ROLES) / @AuthRoles(SUPER_DUPER_ADMIN_ROLES). Applies,
 * within a single @UseGuards so execution order is guaranteed:
 *   1. AuthGuard('jwt')     → populates request.user
 *   2. PermissionsGuard     → the coarse permission every PLATFORM_ADMIN carries
 *                             (defaults to SYSTEM_ACCESS)
 *   3. FeatureToggleGuard   → the per-user narrowing check; fails closed on a
 *                             missing/false toggle row
 *
 * @example
 *   @RequireFeatureToggle(FeatureToggleKey.AI_LAB)
 *   @Get('ai-lab')
 */
export function RequireFeatureToggle(
  featureKey: FeatureToggleKey,
  options: {
    permissions?: string[];
    /** How `permissions` combine; AND unless a route says otherwise. */
    operator?: 'AND' | 'OR';
    tenantPreference?: PreferenceName;
    orgAdminPermission?: string;
    alsoAllowedBy?: FeatureToggleKey;
  } = {},
) {
  const permissions = options.permissions ?? [PERMISSIONS.SYSTEM_ACCESS];
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard, FeatureToggleGuard),
    RequirePermissions(permissions, options.operator ?? 'AND'),
    SetMetadata(FEATURE_TOGGLE_KEY, {
      featureKey,
      tenantPreference: options.tenantPreference,
      orgAdminPermission: options.orgAdminPermission,
      alsoAllowedBy: options.alsoAllowedBy,
    } as FeatureToggleOptions),
  );
}
