import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { RoadmapMetricsService } from './roadmap-metrics.service';
import { resolveMetricsRange } from './roadmap-metrics.util';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

export class RoadmapMetricsQueryDto {
  @ApiPropertyOptional({
    description:
      'Range start, inclusive (ISO date). Default: 30 days before `to`.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Range end, exclusive (ISO date-time); a date alone includes that whole day. Default: now.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/**
 * Roadmap v2 P8: the Owner's Measures (plans/roadmap-builder-merge §7, P8).
 * 404 first while `roadmap_v2` is off, then 403 for anyone but an Owner.
 * Gated by the board's toggle like every `/v1/roadmap` route, so it is not
 * a permission-only route.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapMetricsController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly metrics: RoadmapMetricsService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('metrics')
  @ApiOperation({
    summary:
      'Owner: the funnel, stage times, review wait, held and failed releases, and spend per idea',
  })
  async metricsFor(
    @Query() query: RoadmapMetricsQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    const settings = await this.settings.assertRoadmapV2();
    if ((await this.roles.roleOf(user?.id)) !== 'owner') {
      throw new ForbiddenException('Only an Owner can see the measures.');
    }
    const range = resolveMetricsRange(query ?? {}, new Date());
    if (!range.ok) throw new BadRequestException(range.message);
    return this.metrics.compute({
      from: range.from,
      to: range.to,
      amberDays: settings.awaitingReviewAmberDays,
    });
  }
}
