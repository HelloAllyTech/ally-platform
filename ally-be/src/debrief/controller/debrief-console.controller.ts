import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsObject,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefAgentService } from '../service/debrief-agent.service';
import { DebriefConsoleService } from '../service/debrief-console.service';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefRunJudgeService } from '../service/debrief-run-judge.service';
import { DebriefRunnerService } from '../service/debrief-runner.service';
import { DebriefTestSetsService } from '../service/debrief-test-sets.service';

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

class ModelChangeDto {
  @ApiProperty({
    required: false,
    description: 'step -> model id, e.g. { "writer": "gpt-4.1" }',
  })
  @IsOptional()
  @IsObject()
  steps?: Record<string, string>;

  @ApiProperty({ required: false, description: "Ask Ally's model id" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reply?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class TenantRegionDto {
  @ApiProperty({ enum: ['india', 'outside_india'] })
  @IsIn(['india', 'outside_india'])
  region!: 'india' | 'outside_india';
}

class RunsQueryDto {
  @IsOptional()
  @IsIn(Object.values(DebriefRunMode))
  mode?: DebriefRunMode;

  @IsOptional()
  @IsIn(Object.values(DebriefRunStatus))
  status?: DebriefRunStatus;
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
    private readonly testSets: DebriefTestSetsService,
    private readonly feedback: DebriefFeedbackService,
  ) {}

  @Get('review')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'The review queue: live debriefs a person must finish or check, and open flags',
  })
  review() {
    return this.feedback.queue();
  }

  @Post('runs/:id/publish')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Publish a live run’s best draft as it is' })
  publishRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.feedback.publishRun(id, req.user.id, body?.reason);
  }

  @Post('runs/:id/todays-debrief')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Resolve a learner’s flag: keep the point (with a reason) or remove it',
  })
  resolveFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ResolveFlagDto,
  ) {
    return this.feedback.resolveFlag(
      id,
      req.user.id,
      body.outcome,
      body.note,
      body.correction,
    );
  }

  @Post('flags/:id/escalate')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Debrief agent at a glance: runs, judge scores, cost, budgets',
  })
  overview(@Query('days') days?: string) {
    const d = Number(days);
    return this.console.overview(
      Number.isInteger(d) && d > 0 && d <= 90 ? d : 7,
    );
  }

  @Get('runs')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Recent runs, newest first' })
  runs(@Query() q: RunsQueryDto) {
    return this.console.listRuns({ mode: q.mode, status: q.status });
  }

  @Get('steps')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      "The recipe's steps as capabilities: model, and over 30 days how often each ran, failed or was skipped, its time and spend",
  })
  steps(@Query('days') days?: string) {
    const d = Number(days);
    return this.console.stepUsage(
      Number.isInteger(d) && d > 0 && d <= 90 ? d : 30,
    );
  }

  @Get('runs/:id')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'One run: every step, the checks, the verdicts and the cards',
  })
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.console.getRun(id);
  }

  @Post('sessions/:sessionId/run')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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

  @Get(['pm-agent', 'improver'])
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: "The PM agent's latest report and its ideas" })
  async pmAgentState() {
    return {
      ...(await this.pmAgent.latestReport()),
      ideas: await this.pmAgent.history(50),
    };
  }

  @Post(['pm-agent/analyse', 'improver/analyse'])
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Run the PM agent now (it also runs daily)' })
  analyse(@Req() req: AuthedRequest) {
    return this.pmAgent.analyse({ actorUserId: req.user.id });
  }

  @Post(['pm-agent/ideas/:id/screen', 'improver/ideas/:id/screen'])
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Screen an idea on the open test set against the current release',
  })
  screen(@Param('id', ParseUUIDPipe) id: string) {
    return this.pmAgent.screen(id);
  }

  @Post(['pm-agent/ideas/:id/approve', 'improver/ideas/:id/approve'])
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Approve an idea: it becomes a new release and goes live',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.pmAgent.approve(id, req.user.id, body?.reason);
  }

  @Post(['pm-agent/ideas/:id/reject', 'improver/ideas/:id/reject'])
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Reject an idea' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.pmAgent.reject(id, req.user.id, body?.reason);
  }

  @Get('releases')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Every release, newest first' })
  releases() {
    return this.console.listReleases();
  }

  @Get('models')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      "Each step's model in the live release, and the models a person may pick for it",
  })
  models() {
    return this.console.models();
  }

  @Post('models')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Change step models: makes a new release from the live one and puts it live',
    description:
      "Checked by the same rules as every release (approved, priced, active in the LLM catalog; the Writer and Evaluator on different models, neither on the judge's). Undo with Roll back.",
  })
  setModels(@Req() req: AuthedRequest, @Body() body: ModelChangeDto) {
    return this.console.setModels(
      { steps: body.steps, reply: body.reply },
      req.user.id,
      body.note,
    );
  }

  @Post('releases/:id/rollback')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Make an earlier release live again; takes effect on the next run',
  })
  rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.console.rollback(id, req.user.id, body?.reason);
  }

  @Post('test-sets/build')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Add recent real sessions to the open, gate and sealed sets',
  })
  buildTestSets() {
    return this.testSets.build();
  }

  @Get('tenants')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Organisations and whether their learners read the new debrief',
  })
  tenants() {
    return this.console.tenants();
  }

  @Put('tenants/:tenantId/live')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: "Switch an organisation's learners to the new debrief, or back",
    description: 'Off is the emergency stop for one organisation.',
  })
  async setLive(
    @Param('tenantId') tenantId: string,
    @Body() body: TenantLiveDto,
    @Req() req: AuthedRequest,
  ) {
    await this.agent.setLive(tenantId, body.live, req.user.id);
    return { tenantId, live: body.live };
  }

  @Put('tenants/:tenantId/region')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
}
