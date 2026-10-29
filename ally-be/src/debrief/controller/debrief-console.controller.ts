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
  MaxLength,
} from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefAgentService } from '../service/debrief-agent.service';
import { DebriefConsoleService } from '../service/debrief-console.service';
import { DebriefImproverService } from '../service/debrief-improver.service';
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

class TenantLiveDto {
  @ApiProperty()
  @IsBoolean()
  live!: boolean;
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
 * Improver's report and ideas with the approval layer, releases and rollback,
 * the test sets, and the per-organisation switch. Ally team only, behind the
 * same ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleController {
  constructor(
    private readonly console: DebriefConsoleService,
    private readonly agent: DebriefAgentService,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly improver: DebriefImproverService,
    private readonly testSets: DebriefTestSetsService,
  ) {}

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

  @Get('improver')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: "The Improver's latest report and its ideas" })
  async improverState() {
    return {
      ...(await this.improver.latestReport()),
      ideas: await this.improver.history(50),
    };
  }

  @Post('improver/analyse')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Run the Improver now (it also runs daily)' })
  analyse(@Req() req: AuthedRequest) {
    return this.improver.analyse({ actorUserId: req.user.id });
  }

  @Post('improver/ideas/:id/screen')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Screen an idea on the open test set against the current release',
  })
  screen(@Param('id', ParseUUIDPipe) id: string) {
    return this.improver.screen(id);
  }

  @Post('improver/ideas/:id/approve')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Approve an idea: it becomes a new release and goes live',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.improver.approve(id, req.user.id, body?.reason);
  }

  @Post('improver/ideas/:id/reject')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Reject an idea' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.improver.reject(id, req.user.id, body?.reason);
  }

  @Get('releases')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Every release, newest first' })
  releases() {
    return this.console.listReleases();
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
}
