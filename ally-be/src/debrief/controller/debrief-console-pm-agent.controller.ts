import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefPmConversationService } from '../service/debrief-pm-conversation.service';
import { DebriefPmAgentService } from '../service/debrief-pm-agent.service';
import { DebriefPmAgentRunService } from '../service/debrief-pm-agent-run.service';
import { DebriefPmReportsService } from '../service/debrief-pm-reports.service';
import { DebriefBuilderRequesterService } from '../service/debrief-builder-requester.service';
import {
  ReasonDto,
  ApproveIdeaDto,
  BuilderAnswerDto,
  QuestionDto,
  PmConversationDto,
  StartStepDto,
  ProposeChangeDto,
} from './dto/debrief-console.dto';
import { AuthedRequest, requireOwnerFor } from './console-shared';

/**
 * The Debrief PM agent: its state, conversation, reports and the changes it proposes.
 * Part of the Debrief Console's API (plan §12); Ally team only, behind the same
 * ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsolePmAgentController {
  constructor(
    private readonly pmAgent: DebriefPmAgentService,
    private readonly pmRuns: DebriefPmAgentRunService,
    private readonly view: DebriefConsoleViewService,
    private readonly releaseHistory: DebriefReleasesService,
    private readonly pmReports: DebriefPmReportsService,
    private readonly builderRequester: DebriefBuilderRequesterService,
    private readonly conversation: DebriefPmConversationService,
  ) {}

  @Get('pm-agent')
  @DebriefRead()
  @ApiOperation({
    summary: "The Debrief PM agent's latest report and its ideas",
  })
  async pmAgentState(
    @Req() req: AuthedRequest,
    @Query('state') state?: string,
  ) {
    const viewer = await this.view.viewer(req.user.id);
    const ideas = (await this.pmAgent.history(100)).map((i) =>
      this.view.ideaView(i, viewer),
    );
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

  @Get('pm-agent/conversation')
  @DebriefRead()
  @ApiOperation({
    summary:
      'The one Debrief PM agent conversation, newest page oldest first: { messages, more }. `about` (a change id) narrows it to that change; the clinical advisor sees pinned-rule changes only',
  })
  async pmConversation(
    @Req() req: AuthedRequest,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('about') about?: string,
  ) {
    return this.conversation.list(await this.view.viewer(req.user.id), {
      before: before || undefined,
      limit: Number(limit) || 50,
      about: about || undefined,
    });
  }

  @Post('pm-agent/conversation')
  // The route admits the team, the owner and the advisor; the service keeps
  // the advisor to pinned-rule changes and checks each action's permission.
  @DebriefAct('comment')
  @ApiOperation({
    summary:
      "Talk to the Debrief PM agent: { text, about? } → { messages: [the person's, the agent's reply] }. It answers and acts; an approval waits for an explicit yes. Takes 10–30 s",
  })
  async pmConversationPost(
    @Req() req: AuthedRequest,
    @Body() body: PmConversationDto,
  ) {
    return this.conversation.post(await this.view.viewer(req.user.id), {
      text: body.text,
      about: body.about ?? null,
    });
  }

  @Get('pm-agent/reports')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      "The Debrief PM agent's weekly reports and monthly reviews, newest first (months with records but no review yet included)",
  })
  pmAgentReports() {
    return this.pmReports.list();
  }

  @Get('pm-agent/reports/:kind/:period')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      "One report: what changed in the period (from the records) and the Debrief PM agent's text",
  })
  pmAgentReport(@Param('kind') kind: string, @Param('period') period: string) {
    return this.pmReports.get(kind, period);
  }

  @Post('pm-agent/analyse')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      'Start a Debrief PM agent run now (it also runs weekly, and monthly in depth); the report lands when it finishes',
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
    @Body() body: ApproveIdeaDto,
  ) {
    const idea = await this.pmAgent.getIdea(id);
    // A budgets-only change goes live on the owner's word.
    if (idea.change?.budgetOnly) {
      await requireOwnerFor(this.view, req.user.id, { budgets: true });
    }
    return this.pmAgent.approve(id, req.user.id, body?.reason, {
      answerer: body?.answerer,
    });
  }

  @Get('pm-agent/ideas/:id/builder')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      'Where an idea handed to Builder stands: stage (interviewing, building, PR open, merged, closed), the question waiting for a person, the Debrief PM agent answers, pull requests',
  })
  builderProgress(@Param('id', ParseUUIDPipe) id: string) {
    return this.builderRequester.progress(id);
  }

  @Post('pm-agent/ideas/:id/builder/answer')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      "Answer Builder's waiting question from the idea card, as the person (the same answer the Builder feed sends)",
  })
  answerBuilder(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: BuilderAnswerDto,
  ) {
    return this.builderRequester.answerAsPerson(
      id,
      req.user.id,
      body.questionId,
      {
        selectedOptionIds: body.selectedOptionIds,
        customValues: body.customValues,
        message: body.message ?? body.text,
      },
    );
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

  @Post('pm-agent/ideas/:id/questions')
  @DebriefAct('pmAgent')
  @ApiOperation({
    summary:
      '"Ask a question" on an item waiting for approval; the Debrief PM agent reads it on its next run',
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
    await requireOwnerFor(this.view, req.user.id, body.settings);
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
    await requireOwnerFor(this.view, req.user.id, body.settings);
    return this.releaseHistory.editDraft(id, {
      steps: body.steps,
      settings: body.settings,
      reply: body.reply ?? null,
      prompts: body.prompts ?? null,
    });
  }
}
