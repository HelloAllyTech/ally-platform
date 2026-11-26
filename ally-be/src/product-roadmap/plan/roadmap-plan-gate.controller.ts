import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
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
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapPlanMessageDto } from './plan-gate.dto';
import { PlanCloseReadinessService } from './plan-close-readiness.service';
import { PlanTurnService } from './plan-turn.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * Planning from the idea page (audit 2026-11-19, recs 1 and 2): what the plan
 * still needs before it closes, and the planner's message to the planning
 * agent. Who may call each is decided by the idea's `can` (capabilitiesFor).
 * 404 first while `roadmap_v2` is off, like the rest of the idea flow.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapPlanGateController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly readiness: PlanCloseReadinessService,
    private readonly turns: PlanTurnService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('items/:code/close-readiness')
  @ApiOperation({
    summary:
      "What the plan still needs before it closes: the Close plan dialog's list",
  })
  async closeReadiness(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.readiness.forItem(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/plan-message')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'The planner sends the planning agent a message; it answers in the conversation',
  })
  async planMessage(
    @Param('code') code: string,
    @Body() dto: RoadmapPlanMessageDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.turns.send(user.id, code, dto.text, dto.briefResponse);
  }
}
