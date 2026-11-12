import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsObject,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DEBRIEF_APPROVED_PROVIDERS } from '../constants/debrief-release.constants';
import { DebriefAct, DebriefRead } from '../util/debrief-console-roles.util';
import {
  AUTONOMY_STEPS,
  CHANGE_KINDS,
  parseSessionFilters,
} from '../util/debrief-console-view.util';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefAutonomyService } from '../service/debrief-autonomy.service';
import { DebriefReviewService } from '../service/debrief-review.service';
import { DebriefReleasesService } from '../service/debrief-releases.service';
import {
  DebriefCommentAnchor,
  DebriefCommentStatus,
  DebriefCommentTag,
} from '../enum/debrief-review.enum';
import { COMMENT_BODY_MAX, QUOTE_MAX } from '../util/debrief-review.util';
import { DebriefRunMode } from '../enum/debrief-run.enum';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefAgentService } from '../service/debrief-agent.service';
import { parseMetricsFilter } from '../util/debrief-metrics-filter.util';
import { DebriefConsoleService } from '../service/debrief-console.service';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefPmAgentRunService } from '../service/debrief-pm-agent-run.service';
import { DebriefRunJudgeService } from '../service/debrief-run-judge.service';
import { DebriefRunnerService } from '../service/debrief-runner.service';
import { DebriefTestSetsService } from '../service/debrief-test-sets.service';
import { DebriefSettingsService } from '../service/debrief-settings.service';
import { DebriefMetricsService } from '../service/debrief-metrics.service';
import { DebriefBaselineService } from '../service/debrief-baseline.service';

class ReasonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class CardCorrectionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  lead?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  body?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  why?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  try_saying?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  reason?: string;
}

class ResolveFlagDto {
  @ApiProperty({ enum: ['kept', 'removed', 'corrected'] })
  @IsIn(['kept', 'removed', 'corrected'])
  outcome!: 'kept' | 'removed' | 'corrected';

  @ApiProperty({
    required: false,
    description: 'Required to keep or correct a point: the learner reads it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ required: false, type: CardCorrectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardCorrectionDto)
  correction?: CardCorrectionDto;
}

class TenantLiveDto {
  @ApiProperty()
  @IsBoolean()
  live!: boolean;
}

class SettingsChangeDto {
  @ApiProperty({
    description:
      'Settings to change, by key; null returns a key to its default (v9 FR-60)',
  })
  @IsObject()
  changes!: Record<string, number | boolean | null>;
}

class AcceptBaselineDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keys!: string[];
}

class TenantRegionDto {
  @ApiProperty({ enum: ['india', 'outside_india'] })
  @IsIn(['india', 'outside_india'])
  region!: 'india' | 'outside_india';
}

class TenantProvidersDto {
  @ApiProperty({ enum: DEBRIEF_APPROVED_PROVIDERS, isArray: true })
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(DEBRIEF_APPROVED_PROVIDERS as unknown as string[], { each: true })
  providers!: string[];
}

class CorrectCardDto {
  @ApiProperty({ description: 'The card, e.g. `work_on_this[0]`' })
  @IsString()
  @MaxLength(48)
  section!: string;

  @ApiProperty({ type: CardCorrectionDto })
  @ValidateNested()
  @Type(() => CardCorrectionDto)
  correction!: CardCorrectionDto;

  @ApiProperty({ description: 'What changed: the learner reads it' })
  @IsString()
  @MaxLength(500)
  note!: string;
}

class StillHappeningDto {
  @ApiProperty({ description: 'The later run the problem happened again on' })
  @IsUUID()
  runId!: string;

  @ApiProperty({
    required: false,
    description: 'Defaults to "Still happening."',
  })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body?: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;
}

class ConsoleCommentDto {
  @ApiProperty({ enum: DebriefCommentAnchor })
  @IsEnum(DebriefCommentAnchor)
  anchorKind!: DebriefCommentAnchor;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  turnIndex?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  section?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  spanStart?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  spanEnd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_MAX)
  quotedText?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body!: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

class EditConsoleCommentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_BODY_MAX)
  body?: string;

  @ApiProperty({ required: false, enum: DebriefCommentTag, nullable: true })
  @IsOptional()
  @IsEnum(DebriefCommentTag)
  tag?: DebriefCommentTag | null;
}

class QuestionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  text!: string;
}

class StartStepDto {
  @ApiProperty({ enum: ['gate_test', 'paired_trial'] })
  @IsIn(['gate_test', 'paired_trial'])
  step!: 'gate_test' | 'paired_trial';
}

class PinnedRuleProposalDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  promptCode!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  find!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  replace!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  why!: string;
}

class RequiredReasonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class MatrixCellDto {
  @ApiProperty({ enum: CHANGE_KINDS })
  @IsString()
  kind!: string;

  @ApiProperty({ enum: AUTONOMY_STEPS })
  @IsString()
  step!: string;

  @ApiProperty({ enum: ['auto', 'ask', 'off'] })
  @IsString()
  value!: string;
}

class AutonomyMatrixDto {
  @ApiProperty({ type: [MatrixCellDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => MatrixCellDto)
  changes!: MatrixCellDto[];

  @ApiProperty({
    required: false,
    description:
      'The owner confirmed a canary "on its own" before the judge-agreement gate is met',
  })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

class AutonomyOrgDto {
  @ApiProperty({
    description: '{ paired_trial?, canary?: "default" | "ask" | "never" }',
  })
  @IsObject()
  changes!: Record<string, string>;
}

class BudgetsDto {
  @ApiProperty({ required: false, description: 'The evaluator bar (5–10)' })
  @IsOptional()
  @IsNumber()
  passScore?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  runCeilingUsd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  monthlyCapUsd?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class EmergencyStopDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class ScoreDto {
  @ApiProperty({ description: 'dimension -> 0..10' })
  @IsObject()
  scores!: Record<string, number>;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  hardFails!: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

class StepEditDto {
  @ApiProperty({
    description:
      'A recipe step (`reviser`) or an agent (`agent:protocol_check`)',
  })
  @IsString()
  @MaxLength(64)
  step!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  backupModel?: string | null;
}

class ProposeChangeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  why?: string;

  @ApiProperty({ required: false, type: [StepEditDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StepEditDto)
  steps?: StepEditDto[];

  @ApiProperty({
    required: false,
    description: '{ runCeilingUsd?, monthlyCapUsd?, passScore? } (owner)',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, number>;

  @ApiProperty({ required: false, description: "Ask Ally's model" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reply?: string;

  @ApiProperty({
    required: false,
    description: 'Skills Store versions to ship: { promptCode: version }',
  })
  @IsOptional()
  @IsObject()
  prompts?: Record<string, number>;
}

type AuthedRequest = { user: { id: number } };

/**
 * The Debrief Console's API (plan §12): runs and their timelines, the
 * PM agent's report and ideas with the approval layer, releases and rollback,
 * the test sets, and the per-organisation switch. Ally team only, behind the
 * same ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleController {
  constructor(
    private readonly console: DebriefConsoleService,
    private readonly agent: DebriefAgentService,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly pmAgent: DebriefPmAgentService,
    private readonly pmRuns: DebriefPmAgentRunService,
    private readonly testSets: DebriefTestSetsService,
    private readonly feedback: DebriefFeedbackService,
    private readonly settings: DebriefSettingsService,
    private readonly metrics: DebriefMetricsService,
    private readonly baseline: DebriefBaselineService,
    private readonly view: DebriefConsoleViewService,
    private readonly autonomy: DebriefAutonomyService,
    private readonly reviews: DebriefReviewService,
    private readonly releaseHistory: DebriefReleasesService,
  ) {}

  /** Release settings (budgets, the evaluator bar) are the owner's. */
  private async requireOwnerFor(
    userId: number,
    settings: Record<string, unknown> | undefined,
  ) {
    if (
      settings &&
      Object.keys(settings).length &&
      !(await this.view.viewer(userId)).can.ownerSettings
    ) {
      throw new ForbiddenException(
        'Only the Debrief owner changes budgets and the evaluator bar',
      );
    }
  }

  @Post('runs/:id/publish')
  @DebriefAct('heldDebrief')
  @ApiOperation({ summary: 'Publish a live run’s best draft as it is' })
  publishRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.feedback.publishRun(id, req.user.id, body?.reason);
  }

  @Post('runs/:id/todays-debrief')
  @DebriefAct('heldDebrief')
  @ApiOperation({
    summary: 'Show the learner today’s debrief for this session instead',
  })
  fallbackRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.feedback.fallbackRun(id, req.user.id, body?.reason);
  }

  @Post('runs/:id/reviewed')
  @DebriefAct('heldDebrief')
  @ApiOperation({
    summary: 'A below-the-bar debrief was checked and stays as it is',
  })
  reviewedRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.feedback.markReviewed(id, req.user.id, body?.reason);
  }

  @Post('flags/:id/resolve')
  @DebriefAct('flagDecision')
  @ApiOperation({
    summary:
      'Resolve a learner’s flag: keep the point (with a reason) or remove it',
  })
  async resolveFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ResolveFlagDto,
  ) {
    // A clinical advisor decides only flags escalated to them.
    await this.view.assertFlagDecision(id, await this.view.viewer(req.user.id));
    return this.feedback.resolveFlag(
      id,
      req.user.id,
      body.outcome,
      body.note,
      body.correction,
    );
  }

  @Post('flags/:id/escalate')
  @DebriefAct('escalate')
  @ApiOperation({
    summary: 'Send a flag to the clinical advisor; it stays in the queue',
  })
  escalateFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.feedback.escalateFlag(id, req.user.id, body?.reason);
  }

  @Post('runs/:id/escalate')
  @DebriefAct('escalate')
  @ApiOperation({
    summary: 'Send a debrief waiting in Review to the clinical advisor',
  })
  escalateRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.feedback.escalateRun(id, req.user.id, body?.reason);
  }

  @Get('overview')
  @DebriefRead()
  @ApiOperation({
    summary: 'Debrief agent at a glance: runs, judge scores, cost, budgets',
  })
  overview(@Query('days') days?: string) {
    const d = Number(days);
    return this.console.overview(
      Number.isInteger(d) && d > 0 && d <= 90 ? d : 7,
    );
  }

  @Get('metrics')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Success metrics (v9 §3.3): the weekly steering proxy, guardrails, efficiency, experience by language and device, baselines and monthly uptake lift',
  })
  metricsView(@Query() q: Record<string, string>) {
    const weeks = q.weeks ? Number(q.weeks) || 12 : 12;
    // Organisation, language, learner level, recipe, release version, judge
    // version: one set, applied to every live metric (malformed values dropped).
    return this.metrics.view(weeks, parseMetricsFilter(q));
  }

  @Get('settings')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Owner settings (v9 FR-60): every test-ladder threshold and budget, with the baseline proposal',
  })
  settingsView() {
    return this.settings.view();
  }

  @Put('settings')
  @DebriefAct('ownerSettings')
  @ApiOperation({ summary: 'Change owner settings (audited)' })
  async updateSettings(
    @Req() req: AuthedRequest,
    @Body() body: SettingsChangeDto,
  ) {
    const after = await this.settings.update(body.changes, req.user.id);
    // The old quick-test switch now lives in the autonomy policy's quick-test column.
    if (body.changes && 'pmAgentStartsQuickTests' in body.changes) {
      await this.autonomy.mirrorLegacyQuickTestSwitch(
        after.pmAgentStartsQuickTests,
      );
    }
    return after;
  }

  @Post('settings/accept')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary: "Accept some of the baseline job's proposed values",
  })
  acceptBaseline(@Req() req: AuthedRequest, @Body() body: AcceptBaselineDto) {
    return this.settings.acceptBaseline(body.keys, req.user.id);
  }

  @Post('settings/baseline')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      'Run the baseline job now: propose starting values from production data (it also runs monthly)',
  })
  runBaseline() {
    return this.baseline.run();
  }

  @Post('sessions/:sessionId/run')
  @DebriefAct('releases')
  @ApiOperation({
    summary: 'Debrief one session now, in shadow',
    description:
      'Returns the existing production run when the session already has one. Judged straight after.',
  })
  async runNow(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    const run = await this.runner.run(sessionId, {
      mode: DebriefRunMode.SHADOW,
    });
    if (run.cards && !run.workspace?.judge) {
      await this.judge.judge(run).catch(() => null);
    }
    return run;
  }

  @Get('pm-agent')
  @DebriefRead()
  @ApiOperation({ summary: "The PM agent's latest report and its ideas" })
  async pmAgentState(
    @Req() req: AuthedRequest,
    @Query('state') state?: string,
  ) {
    const viewer = await this.view.viewer(req.user.id);
    // Each pinned rule whose version in force is unapproved gets its item.
    await this.pmAgent.ensureFirstVersionItems().catch(() => 0);
    const ideas = (await this.pmAgent.history(100)).map((i) =>
      this.view.ideaView(i, viewer),
    );
    // Pinned rules: the whole rule with the change highlighted, and the
    // viewer's buttons (first version, own proposal, someone else's).
    await this.pmAgent.pinnedRuleDetails(ideas, viewer);
    const open = ideas.filter((i) => i.state === 'open');
    // An open idea's draft release (its version, what changed against live).
    for (const i of open) {
      (i as Record<string, unknown>).draftRelease = await this.releaseHistory
        .draftFor(i)
        .catch(() => null);
    }
    return {
      ...(await this.pmAgent.latestReport()),
      // Each idea keeps its old fields, plus open/closed, its approval clock
      // (14 days), questions, kind, draft release and what this viewer may do.
      ideas:
        state === 'open' || state === 'closed'
          ? ideas.filter((i) => i.state === state)
          : ideas,
      counts: { open: open.length, closed: ideas.length - open.length },
      viewer: { roles: viewer.roles, can: viewer.can },
    };
  }

  @Post('pm-agent/analyse')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      'Start a PM agent run now (it also runs weekly, and monthly in depth); the report lands when it finishes',
  })
  analyse(@Req() req: AuthedRequest) {
    return this.pmRuns.start(req.user.id);
  }

  @Post('pm-agent/ideas/:id/screen')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary: 'Screen an idea on the open test set against the current release',
  })
  screen(@Param('id', ParseUUIDPipe) id: string) {
    return this.pmAgent.screen(id);
  }

  @Post('pm-agent/ideas/:id/approve')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      'Approve an idea: route A starts its canary or promotes it; B opens a Builder session; C files a bug for Bug Hunter; D marks the question answered',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    const idea = await this.pmAgent.getIdea(id);
    // A budgets-only change goes live on the owner's word.
    if (idea.change?.budgetOnly) {
      await this.requireOwnerFor(req.user.id, { budgets: true });
    }
    return this.pmAgent.approve(id, req.user.id, body?.reason);
  }

  @Post('pm-agent/ideas/:id/reject')
  @DebriefAct('pmAgent')
  @ApiOperation({ summary: 'Reject an idea' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.pmAgent.reject(id, req.user.id, body?.reason);
  }

  @Get('models')
  @DebriefRead()
  @ApiOperation({
    summary:
      "Each step's model in the live release, and the models a person may pick for it",
  })
  models() {
    return this.console.models();
  }

  @Post('releases/orchestrator-challenger')
  @DebriefAct('releases')
  @ApiOperation({
    summary:
      'Make a DRAFT release from the live one with the orchestrator on (a challenger)',
    description:
      'The planner chooses the analysis agents from the registry. Nothing changes for learners until the draft passes the ladder and a person promotes it.',
  })
  async orchestratorChallenger(
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    const draft = await this.console.createOrchestratorChallenger(
      req.user.id,
      body?.reason,
    );
    // It belongs to an idea, like every draft: shown on Ideas, tested there.
    const idea = await this.releaseHistory.adoptDraft(
      draft.releaseId,
      'Orchestrator challenger: the planner chooses the analysis agents',
      body?.reason ?? null,
      req.user.id,
    );
    return { ...draft, ideaId: idea.ideaId };
  }

  @Post('releases/:id/rollback')
  @DebriefAct('releases')
  @ApiOperation({
    summary: 'Make an earlier release live again; takes effect on the next run',
  })
  rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    // Only to a release that has been live; everything it named comes back.
    return this.releaseHistory.rollback(id, req.user.id, body?.reason);
  }

  @Post('test-sets/build')
  @DebriefAct('testSets')
  @ApiOperation({
    summary: 'Add recent real sessions to the open, gate and sealed sets',
  })
  buildTestSets() {
    return this.testSets.build();
  }

  @Get('tenants')
  @DebriefRead()
  @ApiOperation({
    summary: 'Organisations and whether their learners read the new debrief',
  })
  tenants() {
    return this.console.tenants();
  }

  @Put('tenants/:tenantId/live')
  @DebriefAct('emergencyStop')
  @ApiOperation({
    summary: "Switch an organisation's learners to the new debrief, or back",
    description: 'Off is the emergency stop for one organisation.',
  })
  async setLive(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantLiveDto,
    @Req() req: AuthedRequest,
  ) {
    // Off is the emergency stop (Ally team or owner); on is the owner's.
    if (body.live && !(await this.view.viewer(req.user.id)).can.switchOrgOn) {
      throw new ForbiddenException(
        'Only the Debrief owner can switch an organisation on',
      );
    }
    await this.agent.setLive(tenantId, body.live, req.user.id);
    return { tenantId, live: body.live };
  }

  @Put('tenants/:tenantId/region')
  @DebriefAct('switchOrgOn')
  @ApiOperation({
    summary: 'Where an organisation works (v9 FR-25)',
    description:
      'Outside India there is no default support line: the organisation needs its own before it can be switched on.',
  })
  async setRegion(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantRegionDto,
    @Req() req: AuthedRequest,
  ) {
    await this.agent.setRegion(tenantId, body.region, req.user.id);
    return { tenantId, region: body.region };
  }

  @Put('tenants/:tenantId/providers')
  @DebriefAct('switchOrgOn')
  @ApiOperation({
    summary:
      "Which approved model providers an organisation's debriefs may use",
    description:
      'Plan §8.9 / v9 FR-57: live runs, paired trials and Ask Ally on its sessions reach only these providers. At least one.',
  })
  async setProviders(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantProvidersDto,
    @Req() req: AuthedRequest,
  ) {
    const providers = await this.agent.setProviderAllowlist(
      tenantId,
      body.providers,
      req.user.id,
    );
    return { tenantId, providers };
  }

  // --- Redesigned console (docs/debrief-harness/CONSOLE_API.md) ---------------------

  @Get('me')
  @DebriefRead()
  @ApiOperation({
    summary:
      "The viewer's roles and every action they may take (`can`), for hiding buttons",
  })
  async me(@Req() req: AuthedRequest) {
    const v = await this.view.viewer(req.user.id);
    return { userId: v.userId, roles: v.roles, can: v.can, scorer: v.scorer };
  }

  @Get('sessions')
  @DebriefRead()
  @ApiOperation({
    summary:
      'The home list: a category (needs / flagged / below / published / escalated / to_score / all), filters, queue order and counts',
  })
  async sessions(
    @Req() req: AuthedRequest,
    @Query() q: Record<string, string>,
  ) {
    return this.view.sessions(
      parseSessionFilters(q),
      await this.view.viewer(req.user.id),
    );
  }

  @Get('sessions/runs/:id')
  @DebriefRead()
  @ApiOperation({
    summary:
      'One session view: transcript, cards and versions, flags, Ask Ally, distress, skill estimate, judge, comments, queue and pending actions for your role',
  })
  async sessionView(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.view.session(id, await this.view.viewer(req.user.id));
  }

  @Get('attention')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Banners and counts for Debriefs home and the PM agent, only for roles that can act',
  })
  async attention(@Req() req: AuthedRequest) {
    return this.view.attention(await this.view.viewer(req.user.id));
  }

  @Get('analytics')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Analytics › Debriefs: the six tiles, the cost panel and judge agreement',
  })
  analytics(@Query('days') days?: string) {
    const d = Number(days);
    return this.view.analytics(Number.isInteger(d) && d > 0 && d <= 90 ? d : 7);
  }

  @Post('runs/:id/correct')
  @DebriefAct('heldDebrief')
  @ApiOperation({
    summary:
      'Correct a card in place (no flag): quote locked, a "what changed" note the learner reads, a new version, the learner told',
  })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: CorrectCardDto,
  ) {
    return this.feedback.correctRun(
      id,
      body.section,
      body.correction,
      body.note,
      req.user.id,
    );
  }

  @Post('sessions/:sessionId/score')
  @DebriefAct('score')
  @ApiOperation({
    summary:
      'Score by hand (clinical advisor; the Ally team only in the scoring sample). Feeds the κ gate',
  })
  async score(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: AuthedRequest,
    @Body() body: ScoreDto,
  ) {
    return this.view.score(
      sessionId,
      await this.view.viewer(req.user.id),
      body,
    );
  }

  @Post('runs/:id/comments')
  @DebriefAct('comment')
  @ApiOperation({
    summary:
      'Comment on selected words in the roleplay or the debrief, or reply. Never enters the queue',
  })
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ConsoleCommentDto,
  ) {
    return this.reviews.addComment(id, req.user.id, body);
  }

  @Patch('comments/:id')
  @DebriefAct('comment')
  @ApiOperation({ summary: 'Edit your comment' })
  editComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: EditConsoleCommentDto,
  ) {
    return this.reviews.editComment(id, req.user.id, body);
  }

  @Delete('comments/:id')
  @DebriefAct('comment')
  @ApiOperation({ summary: 'Delete your comment' })
  deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.deleteComment(id, req.user.id);
  }

  @Post('comments/:id/resolve')
  @DebriefAct('comment')
  @ApiOperation({ summary: 'Resolve a comment thread' })
  resolveComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.setStatus(
      id,
      req.user.id,
      DebriefCommentStatus.RESOLVED,
    );
  }

  @Post('comments/:id/reopen')
  @DebriefAct('comment')
  @ApiOperation({ summary: 'Re-open a comment thread' })
  reopenComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.reviews.setStatus(id, req.user.id, DebriefCommentStatus.OPEN);
  }

  @Post('comments/:id/still-happening')
  @DebriefAct('comment')
  @ApiOperation({
    summary:
      "Still happening (spec C5): an earlier comment's problem happened again on this later run",
    description:
      'Re-opens the earlier thread and adds a comment on `runId` that points back at it (`repeatOf`). 400 on the same run.',
  })
  stillHappening(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: StillHappeningDto,
  ) {
    return this.reviews.stillHappening(id, req.user.id, {
      runId: body.runId,
      anchorKind: DebriefCommentAnchor.DEBRIEF,
      body: body.body ?? '',
      tag: body.tag ?? null,
    });
  }

  @Post('pm-agent/ideas/:id/questions')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      '"Ask a question" on an item waiting for approval; the PM agent reads it on its next run',
  })
  async ask(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: QuestionDto,
  ) {
    const q = await this.pmAgent.askQuestion(id, req.user.id, body.text);
    // A short answer-only PM agent run, not the weekly one.
    return { ...q, answerRun: this.pmRuns.queueAnswers(req.user.id) };
  }

  @Post('pm-agent/ideas/:id/start-step')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      'Start a step the autonomy policy left waiting ("asks first"): the gate test or the paired trial',
  })
  startStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: StartStepDto,
  ) {
    return this.pmAgent.startStep(id, body.step, req.user.id);
  }

  @Post('pm-agent/ideas/:id/approve-pinned-rule')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      'Approve a pinned-rule change (clinical advisor or owner, their own included): a new prompt version and a DRAFT release the Ally team puts live. A first version records the approval only',
  })
  approvePinnedRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.pmAgent.approvePinnedRule(id, req.user.id, body?.reason);
  }

  @Post('pm-agent/ideas/:id/withdraw-pinned-rule')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      'Withdraw your own pinned-rule proposal (clinical advisor or owner): closed as withdrawn, audited',
  })
  withdrawPinnedRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    return this.pmAgent.withdrawPinnedRule(id, req.user.id);
  }

  @Post('pm-agent/ideas/:id/reject-pinned-rule')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      'Reject a pinned-rule change from the PM agent or another person (clinical advisor or owner), with a reason the PM agent reads. Never a first version',
  })
  rejectPinnedRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: RequiredReasonDto,
  ) {
    return this.pmAgent.rejectPinnedRule(id, req.user.id, body.reason);
  }

  @Post('pinned-rules/proposals')
  @DebriefAct('approvePinnedRule')
  @ApiOperation({
    summary:
      "Propose a change to a pinned rule (safety rules, rubric, judge's instructions), clinical advisor or owner; it waits in PM agent › Ideas for one of them",
  })
  proposePinnedRule(
    @Req() req: AuthedRequest,
    @Body() body: PinnedRuleProposalDto,
  ) {
    return this.pmAgent.proposePinnedRule(body, req.user.id);
  }

  @Get('pinned-rules')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Current pinned versions (safety rules, rubric, judge instructions) with who signed and when, and open proposals',
  })
  async pinnedRules() {
    await this.pmAgent.ensureFirstVersionItems().catch(() => 0);
    return this.view.pinnedRules();
  }

  @Get('autonomy')
  @DebriefRead()
  @ApiOperation({
    summary:
      'What the PM agent may do alone: kind × step matrix with eligibility, per-organisation overrides, re-locks',
  })
  async autonomyView(@Req() req: AuthedRequest) {
    return this.view.autonomyView(await this.view.viewer(req.user.id));
  }

  @Put('autonomy/matrix')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      'Change matrix cells (owner). "auto" only where eligible, except a confirmed canary override; pinned rules are not configurable',
  })
  async setMatrix(@Req() req: AuthedRequest, @Body() body: AutonomyMatrixDto) {
    await this.autonomy.setMatrix(body.changes, req.user.id, !!body.override);
    return this.view.autonomyView(await this.view.viewer(req.user.id));
  }

  @Put('autonomy/orgs/:tenantId')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      "An organisation's overrides (owner): paired_trial / canary → default | ask | never; only tightens",
  })
  async setOrgAutonomy(
    @Param('tenantId') tenantId: string,
    @Req() req: AuthedRequest,
    @Body() body: AutonomyOrgDto,
  ) {
    await this.autonomy.setOrg(tenantId, body.changes, req.user.id);
    return this.view.autonomyView(await this.view.viewer(req.user.id));
  }

  @Put('budgets')
  @DebriefAct('ownerSettings')
  @ApiOperation({
    summary:
      'Owner: change the run ceiling and the monthly cap (a new live release from the current one; undo with Roll back)',
  })
  budgets(@Req() req: AuthedRequest, @Body() body: BudgetsDto) {
    const settings: Record<string, number> = {};
    if (body.runCeilingUsd != null) settings.runCeilingUsd = body.runCeilingUsd;
    if (body.monthlyCapUsd != null) settings.monthlyCapUsd = body.monthlyCapUsd;
    if (body.passScore != null) settings.passScore = body.passScore;
    // A proposed change carrying a draft: budgets alone go live when the
    // owner approves it; the evaluator bar climbs the ladder.
    return this.releaseHistory.proposeChange(
      {
        title: `Settings: ${Object.keys(settings).join(', ')}`,
        why: body.note ?? null,
        settings,
      },
      req.user.id,
    );
  }

  @Post('tenants/:tenantId/emergency-stop')
  @DebriefAct('emergencyStop')
  @ApiOperation({
    summary:
      'Emergency stop (PRD FR-46): the organisation is switched off; its learners see "not available", not today\'s debrief',
  })
  async emergencyStop(
    @Param('tenantId') tenantId: string,
    @Req() req: AuthedRequest,
    @Body() body: EmergencyStopDto,
  ) {
    await this.agent.setLive(tenantId, false, req.user.id);
    return {
      tenantId,
      live: false,
      learnersSee: 'not_available',
      reason: body.reason,
    };
  }

  // --- Ideas carry proposed changes; Releases is the live history -----------------

  @Post('pm-agent/ideas/propose')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      'Propose a change: a person-made idea carrying a draft release (steps on/off, model swaps, release settings) that climbs the ladder',
  })
  async proposeChange(
    @Req() req: AuthedRequest,
    @Body() body: ProposeChangeDto,
  ) {
    await this.requireOwnerFor(req.user.id, body.settings);
    return this.releaseHistory.proposeChange(
      {
        title: body.title,
        why: body.why ?? null,
        steps: body.steps,
        settings: body.settings,
        reply: body.reply ?? null,
        prompts: body.prompts ?? null,
      },
      req.user.id,
    );
  }

  @Patch('pm-agent/ideas/:id/draft')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary: "Change a proposed change's draft release before its tests start",
  })
  async editDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ProposeChangeDto,
  ) {
    await this.requireOwnerFor(req.user.id, body.settings);
    return this.releaseHistory.editDraft(id, {
      steps: body.steps,
      settings: body.settings,
      reply: body.reply ?? null,
      prompts: body.prompts ?? null,
    });
  }

  @Get('release-history')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Releases that have been live (Live, Retired, Rolled back), newest first, and code releases waiting as drafts',
  })
  releaseHistoryList() {
    return this.releaseHistory.list();
  }

  @Get('release-history/:id')
  @DebriefRead()
  @ApiOperation({
    summary:
      'One release: release notes, where it came from, evidence before and while live, and what is in it',
  })
  async releaseHistoryDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ) {
    const viewer = await this.view.viewer(req.user.id);
    const r = await this.releaseHistory.detail(id);
    return {
      ...r,
      can: { rollBack: viewer.can.releases && r.status === 'retired' },
    };
  }

  @Get('releases/:id/compare')
  @DebriefRead()
  @ApiOperation({
    summary:
      'Compare a release with another (default: the one before): changes, and both texts of each changed prompt',
  })
  compareRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('with') withId?: string,
  ) {
    return this.releaseHistory.compare(
      id,
      withId && /^[0-9a-f-]{36}$/i.test(withId) ? withId : undefined,
    );
  }

  @Post('releases/:id/promote-waiting')
  @DebriefAct('releases')
  @ApiOperation({
    summary:
      'Promote a Skills Store or code release that waits because it would undo a promoted change (accept the overwrite)',
  })
  promoteWaiting(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.releaseHistory.promoteWaiting(id, req.user.id, body?.reason);
  }

  @Post('releases/:id/dismiss-waiting')
  @DebriefAct('releases')
  @ApiOperation({
    summary:
      'Dismiss a waiting Skills Store or code release: it never goes live (who and why are recorded)',
  })
  dismissWaiting(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.releaseHistory.dismissWaiting(id, req.user.id, body?.reason);
  }
}
