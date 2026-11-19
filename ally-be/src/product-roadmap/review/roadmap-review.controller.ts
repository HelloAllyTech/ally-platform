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
import {
  RoadmapBatchReviewDto,
  RoadmapLeadDto,
  RoadmapReviewDto,
  RoadmapReviewUndoDto,
} from '../draft/roadmap-draft.dto';
import { RoadmapClosePlanDto } from '../plan/plan-gate.dto';
import { RoadmapReviewService } from './roadmap-review.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * Roadmap v2 P3: the Owner's review, bulk triage with one undo, the lead and
 * the suggested lead (plans/roadmap-builder-merge D10, D11, §4.6, §4.11).
 * 404 first while `roadmap_v2` is off. The batch and undo paths escape the
 * colon (`review\:batch`) so Express 5 reads it as text, not a parameter.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapReviewController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly reviews: RoadmapReviewService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/review\\:batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Owner: review many ideas at once, one undo token' })
  async batch(
    @Body() dto: RoadmapBatchReviewDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.reviewBatch(user.id, dto.items);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/review\\:undo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Owner: undo a review or a batch inside its window',
  })
  async undo(
    @Body() dto: RoadmapReviewUndoDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.undo(user.id, dto.undoToken);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Owner: accept, decline with a reason, or reopen (a lead is assigned later, after the plan is closed)',
  })
  async review(
    @Param('code') code: string,
    @Body() dto: RoadmapReviewDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.review(user.id, { ...dto, code });
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/lead')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Owner picks or changes the lead; the lead hands the idea back',
  })
  async lead(
    @Param('code') code: string,
    @Body() dto: RoadmapLeadDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.lead(user.id, code, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/start-planning')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Start planning: an Owner expands the idea into a plan (accepts it if it was waiting)',
  })
  async startPlanning(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.startPlanning(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/conversation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Open the conversation on an older idea that has none, so it can take comments',
  })
  async openConversation(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.openConversation(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/close-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Owner: close the plan, so a builder can be assigned',
  })
  async closePlan(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
    @Body() dto: RoadmapClosePlanDto = {},
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.setPlanClosed(user.id, code, true, dto?.reason);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('items/:code/reopen-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Owner: reopen a closed plan while no builder is assigned',
  })
  async reopenPlan(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.setPlanClosed(user.id, code, false);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('items/:code/lead-suggestions')
  @ApiOperation({ summary: 'Owner: the lead picker, best first, with why' })
  async leadSuggestions(
    @Param('code') code: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.settings.assertRoadmapV2();
    return this.reviews.leadSuggestions(user.id, code);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('items/:code/similar')
  @ApiOperation({
    summary: 'At most two similar ideas (existing duplicate detection)',
  })
  async similar(@Param('code') code: string, @CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.reviews.similar(user.id, code);
  }
}
