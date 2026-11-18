import {
  Body,
  Controller,
  ConflictException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DebriefAct, DebriefRead } from '../util/debrief-console-roles.util';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefReleasesService } from '../service/debrief-releases.service';
import { DebriefRunMode } from '../enum/debrief-run.enum';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefConsoleService } from '../service/debrief-console.service';
import { DebriefRunJudgeService } from '../service/debrief-run-judge.service';
import { DebriefRunnerService } from '../service/debrief-runner.service';
import { DebriefTestSetsService } from '../service/debrief-test-sets.service';
import { ReasonDto } from './dto/debrief-console.dto';
import { AuthedRequest } from './console-shared';

/**
 * Releases: run now, the orchestrator challenger, rollback, history, compare and waiting releases; test sets.
 * Part of the Debrief Console's API (plan §12); Ally team only, behind the same
 * ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleReleasesController {
  constructor(
    private readonly console: DebriefConsoleService,
    private readonly runner: DebriefRunnerService,
    private readonly judge: DebriefRunJudgeService,
    private readonly testSets: DebriefTestSetsService,
    private readonly view: DebriefConsoleViewService,
    private readonly releaseHistory: DebriefReleasesService,
  ) {}

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
    // The session already has a run this one could not take over.
    if (!run) {
      throw new ConflictException(
        'This session already has a debrief run; open it from its session',
      );
    }
    if (run.cards && !run.workspace?.judge) {
      await this.judge.judge(run).catch(() => null);
    }
    return run;
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
