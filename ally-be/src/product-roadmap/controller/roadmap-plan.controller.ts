import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PlanNotificationService } from 'src/product-planning/service/plan-notification.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import type { PlanCheckKind } from 'src/product-planning/util/plan-readiness.util';
import {
  AnswerAuthorQuestionDto,
  AskAuthorDto,
  ClosePlanDto,
  FilePlanDto,
  HandBackDto,
  LaunchItemDoneDto,
  PlanTurnDto,
  ResolveFindingDto,
  SetImpactTagsDto,
  SetSuccessMeasureDto,
  StartPlanDto,
} from '../plan/plan.dto';
import { PlanIdeaService } from '../plan/plan-idea.service';
import { PlanLeadService } from '../plan/plan-lead.service';
import { PlanLaunchService } from '../plan/plan-launch.service';
import { PlanOutcomeService } from '../plan/plan-outcome.service';
import { PlanDiscoveryService } from '../plan/plan-discovery.service';
import { PlanExportService } from '../plan/plan-export.service';

class MarkReadDto {
  @IsOptional() @IsString() id?: string;
}
class ObservationDto {
  @IsString() @MaxLength(8000) observed!: string;
}
class MeasureChangeDto extends SetSuccessMeasureDto {
  @IsOptional() @IsString() @MaxLength(1000) changeReason?: string;
}

const VOTE = { permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP] };
const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * The roadmap's idea-to-outcome plan (plans/roadmap-owns-planning rev 5.2).
 *
 * Every route sits on the Product Roadmap tab's toggle, like the rest of the
 * roadmap; WHO may do WHAT is decided inside the services by PlanAccessService
 * (the Ideas and Lead toggles, the author rule) and every route answers 404
 * while `builder_settings.planningEnabled` is off. The PRD, design and build
 * themselves happen in the plan's Builder session.
 */
@ApiTags('Product Roadmap — plans')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap/plans', version: '1' })
export class RoadmapPlanController {
  constructor(
    private readonly ideas: PlanIdeaService,
    private readonly leads: PlanLeadService,
    private readonly launch: PlanLaunchService,
    private readonly outcomes: PlanOutcomeService,
    private readonly discovery: PlanDiscoveryService,
    private readonly exporter: PlanExportService,
    private readonly notifications: PlanNotificationService,
    private readonly settings: PlanSettingsService,
  ) {}

  // ── Static routes first: Nest matches in declaration order ────────────────

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('settings')
  @ApiOperation({ summary: 'Whether planning is on, and its limits' })
  async planSettings() {
    return this.settings.get();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Get('mine')
  @ApiOperation({
    summary: "The caller's own plans: private ideas and filed ones",
  })
  mine(@CurrentUser() user: TokenUser) {
    return this.ideas.listMine(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('queue')
  @ApiOperation({
    summary: 'Needs a lead: filed plans nobody leads (Lead toggle)',
  })
  queue(@CurrentUser() user: TokenUser) {
    return this.leads.queue(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('notifications')
  @ApiOperation({ summary: "The caller's plan notifications" })
  async listNotifications(@CurrentUser() user: TokenUser) {
    await this.settings.assertEnabled();
    return this.notifications.listFor(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('notifications/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification (or all) read' })
  async markRead(@CurrentUser() user: TokenUser, @Body() dto: MarkReadDto) {
    await this.notifications.markRead(user.id, dto.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('signals')
  @ApiOperation({
    summary: 'Suggested ideas from the weekly signal scout (Lead toggle)',
  })
  signals(@CurrentUser() user: TokenUser) {
    return this.discovery.listSuggestions(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('signals/:suggestionId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dismiss a suggestion for 90 days' })
  dismissSignal(
    @CurrentUser() user: TokenUser,
    @Param('suggestionId', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.dismiss(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('signals/:suggestionId/work-up')
  @ApiOperation({ summary: 'Start a private plan from a suggestion' })
  workUpSignal(
    @CurrentUser() user: TokenUser,
    @Param('suggestionId', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.workUp(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Post()
  @ApiOperation({ summary: 'Park an idea, or start working it up' })
  start(@CurrentUser() user: TokenUser, @Body() dto: StartPlanDto) {
    return this.ideas.start(user.id, dto);
  }

  // ── One plan ──────────────────────────────────────────────────────────────

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get(':id')
  @ApiOperation({ summary: 'One plan, as the caller may see it' })
  get(@CurrentUser() user: TokenUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ideas.get(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Post(':id/turn')
  @ApiOperation({ summary: 'One copilot turn on a private idea' })
  turn(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlanTurnDto,
  ) {
    return this.ideas.turn(id, user.id, dto.text);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Post(':id/file')
  @ApiOperation({ summary: 'File the idea to the roadmap (idempotent)' })
  file(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FilePlanDto,
  ) {
    return this.ideas.file(id, user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Post(':id/archive')
  archive(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ideas.archive(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Post(':id/restore')
  restore(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ideas.restore(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard an unfiled idea for good' })
  discard(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ideas.discard(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VOTE)
  @Post(':id/author-answers/:questionId')
  @ApiOperation({ summary: "The author answers the lead's question" })
  answerAuthorQuestion(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: AnswerAuthorQuestionDto,
  ) {
    return this.leads.answerAuthorQuestion(id, user.id, questionId, dto.answer);
  }

  // ── Lead (the Lead toggle, checked in the service) ────────────────────────

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/take-on')
  takeOn(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.takeOn(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/hand-back')
  handBack(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandBackDto,
  ) {
    return this.leads.handBack(id, user.id, dto.note);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/close')
  close(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClosePlanDto,
  ) {
    return this.leads.close(id, user.id, dto.reason);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/close/confirm')
  confirmClose(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.confirmClose(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/reopen')
  reopen(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.reopen(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/ask-author')
  askAuthor(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskAuthorDto,
  ) {
    return this.leads.askAuthor(id, user.id, dto.question);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Put(':id/impact-tags')
  setImpactTags(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetImpactTagsDto,
  ) {
    return this.leads.setImpactTags(id, user.id, dto.tags);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Put(':id/success-measure')
  setSuccessMeasure(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MeasureChangeDto,
  ) {
    const { changeReason, ...measure } = dto;
    return this.leads.setSuccessMeasure(id, user.id, measure, changeReason);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get(':id/catch-up')
  catchUp(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.catchUp(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get(':id/checks')
  listChecks(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leads.listChecks(id, user.id);
  }

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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/checks/:kind/findings/:findingId/resolve')
  @ApiOperation({
    summary: 'Resolve a finding: fixed or dismissed, always with a reason',
  })
  resolveFinding(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() dto: ResolveFindingDto,
  ) {
    return this.leads.resolveFinding(
      id,
      user.id,
      kind as PlanCheckKind,
      findingId,
      dto,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/research')
  @ApiOperation({ summary: 'Plan a real-user test of the riskiest assumption' })
  research(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.researchPlan(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/launch/draft')
  @ApiOperation({ summary: 'Draft the launch materials (proposals only)' })
  draftLaunch(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.launch.draft(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/launch/items/:itemId')
  @ApiOperation({
    summary: 'Tick a launch item off once a person has published it',
  })
  markLaunchItem(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: LaunchItemDoneDto,
  ) {
    return this.launch.markItem(id, user.id, itemId, dto.done);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get(':id/outcomes')
  async listOutcomes(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.ideas.get(id, user.id);
    return this.outcomes.list(id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post(':id/outcomes/:dueDate/observation')
  @ApiOperation({
    summary: 'Record what was observed for a manual success measure',
  })
  recordObservation(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dueDate') dueDate: string,
    @Body() dto: ObservationDto,
  ) {
    return this.outcomes.recordObservation(id, user.id, dueDate, dto.observed);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get(':id/export')
  @ApiOperation({
    summary: 'Download the plan: Markdown plus a versioned JSON sidecar',
  })
  export(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exporter.package(id, user.id);
  }
}
