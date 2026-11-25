import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RateLimit } from 'src/rate-limit/decorator/rate-limit.decorator';

import { BUG_REPORT_RATE_LIMIT } from '../constants/product-roadmap.constants';
import {
  CreateBugReportDto,
  SuggestTitleDto,
  SetAllocationDto,
} from '../dto/roadmap-opportunity.dto';
import {
  VoteBudgetDto,
  BreadthDto,
  BugReportResponseDto,
  OpportunityResponseDto,
  RoadmapFacetsDto,
  OpportunityBriefResponseDto,
  SetAllocationResponseDto,
} from '../dto/roadmap-response.dto';
import { RoadmapAiService } from '../service/roadmap-ai.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapMultiplierService } from '../service/roadmap-multiplier.service';
import { RoadmapAllocationService } from '../service/roadmap-allocation.service';

/**
 * What is left of the old board's opportunity routes once the Roadmap (v2) replaced it: the
 * reads and the vote the Roadmap pages still call, the title suggestion, and the bug-report
 * route web, mobile and helpline file on. Filing, editing, the month board, split/merge and
 * the Builder hand-off moved to `/roadmap/*`.
 *
 * Permission tiers, applied per handler:
 *   VIEW_PRODUCT_ROADMAP — read
 *   VOTE_PRODUCT_ROADMAP — cast votes, suggest a title
 */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapOpportunityController {
  constructor(
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly allocationService: RoadmapAllocationService,
    private readonly multiplierService: RoadmapMultiplierService,
    private readonly roadmapAi: RoadmapAiService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('facets')
  @ApiOperation({
    summary: 'Distinct filter options',
    description:
      'Exists because deriving filter options from the loaded rows breaks as soon as the list ' +
      'is paginated.',
  })
  @ApiResponse({ status: 200, type: RoadmapFacetsDto })
  facets(): Promise<RoadmapFacetsDto> {
    return this.opportunityService.getFacets();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('me/vote-budget')
  @ApiOperation({
    summary: "The caller's remaining votes for the current period",
  })
  @ApiResponse({ status: 200, type: VoteBudgetDto })
  budget(@CurrentUser() user: TokenUser): Promise<VoteBudgetDto> {
    return this.allocationService.getBudget(user.id);
  }

  // VIEW tier, not VOTE: every viewer's score label ("points" vs "votes") hangs on `enabled`.
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('me/breadth')
  @ApiOperation({
    summary: "The caller's breadth multiplier and what's behind it",
    description:
      'A vote is worth 1.0 to 1.3 of a vote by how many different colleagues the caller has ' +
      'backed in the last 14 days. `enabled` is false while the feature flag is off.',
  })
  @ApiResponse({ status: 200, type: BreadthDto })
  breadth(@CurrentUser() user: TokenUser): Promise<BreadthDto> {
    return this.multiplierService.getBreadth(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('opportunities/:id')
  @ApiOperation({
    summary: 'One opportunity',
    description:
      'Used for the ?opportunity=<id> deep link, where the row may not be on the current page.',
  })
  @ApiResponse({ status: 200, type: OpportunityResponseDto })
  findOne(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OpportunityResponseDto> {
    return this.opportunityService.findOne(user.id, id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('opportunities/:id/brief')
  @ApiOperation({
    summary: "The opportunity copilot's brief, as filed",
    description:
      'Strategic fit, reach, evidence, success metric, assumptions, what was dropped and the ' +
      "copilot's assessment. `brief` is null for anything filed without one. Fetched by the " +
      'drawer when `hasBrief` is true, rather than riding on every board row.',
  })
  @ApiResponse({ status: 200, type: OpportunityBriefResponseDto })
  findBrief(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OpportunityBriefResponseDto> {
    return this.opportunityService.getBrief(id);
  }

  /**
   * A suggested title for an idea's text, for the Title box to prefill. Always on: the form
   * that files an idea needs it whether or not the Roadmap is on. On the VOTE tier like filing
   * itself. A failed model call answers with the text's first sentence, never an error.
   */
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Post('title-suggestion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suggest a one-line title for an idea' })
  async suggestTitle(@Body() dto: SuggestTitleDto): Promise<{ title: string }> {
    return { title: await this.roadmapAi.suggestTitle(dto.text) };
  }

  /**
   * The ONE route every bug report takes: a consumer in web/mobile/helpline, and a staff
   * member using the admin roadmap's "Report a problem" button, both land here. Deliberately
   * a plain JwtAuthGuard rather than widening vote:admin:product-roadmap to consumer
   * accounts, so every report carries the same silently-captured triage context regardless
   * of who filed it. `source` is derived from the reporter's own roles; see
   * isInternalReporter.
   *
   * Goes through the same RoadmapOpportunityService.create() pipeline every opportunity
   * takes (Bug Hunter inbox row, vector indexing), so it needs no bespoke follow-up work to
   * show up where bugs are triaged.
   */
  // @RateLimit stays ABOVE @UseGuards(JwtAuthGuard): guard decorators stack bottom-up, and
  // the per-user throttle has to run after JwtAuthGuard has set req.user.
  @RateLimit({
    key: 'userId',
    limit: BUG_REPORT_RATE_LIMIT.LIMIT,
    ttl: BUG_REPORT_RATE_LIMIT.TTL_MS,
    errorMessage: 'Too many bug reports. Please try again later.',
  })
  @UseGuards(JwtAuthGuard)
  @Post('bug-reports')
  @ApiOperation({
    summary: 'File a bug report as any logged-in user',
    description:
      'Lands as a `bug`-type opportunity and, through the same pipeline, as a row in Bug ' +
      "Hunter's findings table — where bugs are triaged, since they no longer render on " +
      "the roadmap board. `source` is stamped 'staff' or 'consumer' from the reporter's " +
      'own roles. No severity or category picker — the description is the answer to a ' +
      'single guided prompt. Not run through any crisis-content safety pipeline: this is ' +
      'a plain admin-visible field.',
  })
  @ApiResponse({ status: 201, type: BugReportResponseDto })
  createBugReport(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateBugReportDto,
  ): Promise<BugReportResponseDto> {
    return this.opportunityService.createBugReport(
      user.id,
      user.tenantId ?? null,
      dto,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Put('allocations')
  @ApiOperation({
    summary: 'Set the caller’s votes on one opportunity',
    description:
      'Idempotent; votes:0 deletes the allocation. periodKey is NOT accepted — the server ' +
      'computes it in UTC, which closes the source hole where any period could be written. ' +
      'Returns both the opportunity aggregate and the budget so an optimistic client can ' +
      'reconcile without refetching the list.',
  })
  @ApiResponse({ status: 200, type: SetAllocationResponseDto })
  setAllocation(
    @CurrentUser() user: TokenUser,
    @Body() dto: SetAllocationDto,
  ): Promise<SetAllocationResponseDto> {
    return this.allocationService.setVotes(
      user.id,
      dto.opportunityId,
      dto.votes,
    );
  }
}
