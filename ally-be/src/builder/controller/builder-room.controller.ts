import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { BuilderHistoryService } from '../service/builder-history.service';
import { BuilderNowService } from '../service/builder-now.service';
import {
  AskBuilderDto,
  CreateBuilderRuleDto,
  DraftBuilderRuleDto,
  ListBuilderHistoryQueryDto,
  PreviewBuilderRuleDto,
  TellBuilderDto,
  UpdateBuilderRuleDto,
} from '../dto/builder.dto';
import { BuilderAskService } from '../service/builder-ask.service';
import { BuilderRulesService } from '../service/builder-rules.service';
import { BuilderPartnerMetricsService } from '../service/builder-partner-metrics.service';

/**
 * The Builder tab's own surface — Now, Rules and History — kept apart from
 * BuilderController, which is the session page's. The decision feed itself
 * (list, answer, undo) stays on BuilderController next to the session actions
 * it routes to.
 */
@ApiTags('Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder', version: '1' })
export class BuilderRoomController {
  constructor(
    private readonly historyService: BuilderHistoryService,
    private readonly nowService: BuilderNowService,
    private readonly askService: BuilderAskService,
    private readonly rulesService: BuilderRulesService,
    private readonly partnerMetrics: BuilderPartnerMetricsService,
  ) {}

  /**
   * The Now tab in one read: sessions in progress grouped by what they wait
   * on, the decisions waiting on a person, and the in-progress limit.
   */
  @Get('now')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'The Builder tab: in progress, decisions, limit' })
  now() {
    return this.nowService.now();
  }

  /** Every decision, ask and tell, newest first. Read-only: corrections are rules, never edits. */
  @Get('history')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Builder History, searched and filtered' })
  listHistory(
    @Query() query: ListBuilderHistoryQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.historyService.list(query, user.id);
  }

  /* ── Ask and Tell ──────────────────────────────────────────────────────── */

  /** A read-only question to one session. Takes no turn lock and changes nothing. */
  @Post('sessions/:sessionId/ask')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Ask a session a read-only question' })
  ask(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AskBuilderDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.askService.ask(sessionId, dto.question, user.id);
  }

  /** An instruction: to the interview now, or queued for the next run. */
  @Post('sessions/:sessionId/tell')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Tell a session to change something' })
  tell(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: TellBuilderDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.askService.tell(
      sessionId,
      dto.instruction,
      dto.applyNow === true,
      user.id,
    );
  }

  /** A session's asks and tells, oldest first, for its thread. */
  @Get('sessions/:sessionId/thread')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: "A session's asks and tells" })
  thread(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.askService.thread(sessionId);
  }

  /** ⌘K → Ask about all work. Read-only. */
  @Post('ask')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: "Ask about all of Builder's work" })
  askAll(@Body() dto: AskBuilderDto, @CurrentUser() user: TokenUser) {
    return this.askService.askAll(dto.question, user.id);
  }

  /* ── Rules ─────────────────────────────────────────────────────────────── */

  @Get('rules')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Every rule, with how often each applied' })
  listRules() {
    return this.rulesService.list();
  }

  @Post('rules/draft')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: "Builder's general rule from one of your answers" })
  draftRule(@Body() dto: DraftBuilderRuleDto) {
    return this.rulesService.draft(dto.historyId);
  }

  @Post('rules/preview')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'What a rule would have applied to in the last 90 days, and what it contradicts',
  })
  previewRule(@Body() dto: PreviewBuilderRuleDto) {
    return this.rulesService.preview(dto);
  }

  @Post('rules')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Save a rule (superseding any it replaces)' })
  createRule(
    @Body() dto: CreateBuilderRuleDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.rulesService.create(dto, user.id);
  }

  @Patch('rules/:ruleId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Turn a rule on or off' })
  updateRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateBuilderRuleDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.rulesService.setActive(ruleId, dto.active, user.id);
  }

  /** "Shall I decide this for you?" — offered after ten agreements in a row. */
  @Get('rules/proposals')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Decide-for-me proposals, earned from History' })
  proposals() {
    return this.rulesService.proposals();
  }

  @Delete('rules/proposals/:key')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: '"Not yet": hide a proposal for 30 days' })
  dismissProposal(@Param('key') key: string) {
    return this.rulesService.dismissProposal(key.slice(0, 80));
  }

  /* ── Scoreboard ────────────────────────────────────────────────────────── */

  @Get('partner-scoreboard')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'Waiting on you, asked twice, agreement, caution and pace, from History',
  })
  partnerScoreboard(@Query('windowDays') windowDays?: string) {
    return this.partnerMetrics.scoreboard(Number(windowDays) || 30);
  }
}
