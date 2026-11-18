import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DebriefAct } from '../util/debrief-console-roles.util';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';
import { DebriefReviewService } from '../service/debrief-review.service';
import {
  DebriefCommentAnchor,
  DebriefCommentStatus,
} from '../enum/debrief-review.enum';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import {
  ReasonDto,
  ResolveFlagDto,
  CorrectCardDto,
  StillHappeningDto,
  ConsoleCommentDto,
  EditConsoleCommentDto,
} from './dto/debrief-console.dto';
import { AuthedRequest } from './console-shared';

/**
 * Held debriefs, flags and review comments: the actions on one run, flag or comment.
 * Part of the Debrief Console's API (plan §12); Ally team only, behind the same
 * ANALYTICS toggle as the calibration set.
 */
@ApiTags('Debriefs')
@Controller('v1/debriefs/console')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefConsoleReviewController {
  constructor(
    private readonly feedback: DebriefFeedbackService,
    private readonly view: DebriefConsoleViewService,
    private readonly reviews: DebriefReviewService,
  ) {}

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
}
