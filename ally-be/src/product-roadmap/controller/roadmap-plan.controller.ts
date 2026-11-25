import { Controller, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import type { PlanCheckKind } from 'src/product-planning/util/plan-readiness.util';
import { PlanLeadService } from '../plan/plan-lead.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * The one route left of the first plan flow's controller (plans/roadmap-owns-planning rev 5.2):
 * running a plan's review-board checks, which the Roadmap's Close plan dialog still calls at
 * this path. WHO may run them is decided in PlanLeadService (`assertPlanWorkOn`: it answers
 * while either the Roadmap or the old planning flag is on). Every other plan route moved to
 * `/roadmap/items/:code/*`.
 */
@ApiTags('Product Roadmap — plans')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap/plans', version: '1' })
export class RoadmapPlanController {
  constructor(private readonly leads: PlanLeadService) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/checks/run')
  @ApiOperation({
    summary: 'Run the checks the plan requires (or one with ?kind=)',
  })
  runChecks(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('kind') kind?: string,
  ) {
    const only = ['safety', 'privacy', 'ai_quality'].includes(kind ?? '')
      ? (kind as PlanCheckKind)
      : undefined;
    return this.leads.runChecks(id, user.id, only);
  }
}
