import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleGuard } from 'src/auth/guards/feature-toggle.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermissions } from 'src/auth/decorators/permissions.decorator';
import {
  FEATURE_TOGGLE_KEY,
  FeatureToggleOptions,
} from 'src/auth/decorators/feature-toggle.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import {
  roleAtLeast,
  RoadmapRole,
} from 'src/product-planning/util/roadmap-role.util';
import {
  BuilderSessionKind,
  BuilderSessionVisibility,
} from '../enum/builder.enum';
import { BuilderBuildRunRepository } from '../repository/builder-build.repository';
import { BuilderSessionRepository } from '../repository/builder-session.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The least Roadmap role that may read a shared plan session (D2). */
const READ_FLOOR: RoadmapRole = 'idea';

/**
 * Roadmap v2 (D2: Idea people see everything, read-only). Wraps Builder's own
 * gate (permission + toggle) on a session's read routes and adds one narrow
 * way in: with `roadmap_v2` on, a GET on a SHARED `kind='plan'` session passes
 * for any caller whose Roadmap role is Idea or above.
 *
 * Builder's own gate always runs first, so a Builder user is untouched; only a
 * caller it refuses is considered here. A private draft, a non-plan session,
 * any write, a Viewer (tenant-restricted) and a flag-off request all keep the
 * original refusal. Run ids are resolved to their session, so the events feed
 * follows the same rule.
 */
@Injectable()
export class BuilderPlanReadGuard implements CanActivate {
  constructor(
    private readonly permissions: PermissionsGuard,
    private readonly toggles: FeatureToggleGuard,
    private readonly sessions: BuilderSessionRepository,
    private readonly runs: BuilderBuildRunRepository,
    @Optional() private readonly settings?: PlanSettingsService,
    @Optional() private readonly roles?: RoadmapRoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (
        (await this.permissions.canActivate(context)) &&
        (await this.toggles.canActivate(context))
      );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      if (await this.planReadAllowed(context)) return true;
      throw error;
    }
  }

  private async planReadAllowed(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (String(request.method ?? 'GET').toUpperCase() !== 'GET') return false;
    const userId: number | undefined = request.user?.id;
    if (!userId) return false;
    try {
      if (!(await this.settings?.getRoadmapV2())?.enabled) return false;
      const role = (await this.roles?.roleOf(userId)) ?? 'none';
      if (!roleAtLeast(role, READ_FLOOR)) return false;

      let sessionId: unknown = request.params?.sessionId;
      if (!sessionId && typeof request.params?.runId === 'string') {
        if (!UUID.test(request.params.runId)) return false;
        sessionId = (
          await this.runs.findOne({
            where: { id: request.params.runId },
            select: { id: true, sessionId: true },
          })
        )?.sessionId;
      }
      if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return false;
      const facts = await this.sessions.findVisibilityFacts(sessionId);
      return (
        !!facts &&
        facts.kind === BuilderSessionKind.PLAN &&
        facts.visibility !== BuilderSessionVisibility.PRIVATE
      );
    } catch {
      // Fail closed: a failed lookup keeps Builder's own refusal.
      return false;
    }
  }
}

/**
 * Drop-in for `@RequireFeatureToggle(BUILDER, …)` on a session read route:
 * same permission, toggle and alternate-toggle rules, plus the Roadmap v2
 * read-only path above. Use on GET routes only.
 */
export function RequireBuilderOrPlanRead(options: {
  permissions: string[];
  alsoAllowedBy?: FeatureToggleKey;
}) {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), BuilderPlanReadGuard),
    RequirePermissions(
      options.permissions ?? [PERMISSIONS.VIEW_BUILDER],
      'AND',
    ),
    SetMetadata(FEATURE_TOGGLE_KEY, {
      featureKey: FeatureToggleKey.BUILDER,
      alsoAllowedBy: options.alsoAllowedBy,
    } as FeatureToggleOptions),
  );
}
