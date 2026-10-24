import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { atmosphereFor } from '../constants/guide.constants';
import {
  GuideVoiceSessionDto,
  GuideAppointmentDto,
  GuideCardEventDto,
  GuideMessageFeedbackDto,
  GuideMicroActivityResponseDto,
  GuidePrefsUpdateDto,
  GuideTurnRequestDto,
} from '../dto/guide.dto';
import { GuideLearnerDataService } from '../learner/guide-learner-data.service';
import { GuideCardService } from '../runtime/guide-card.service';
import { GuideViewService } from '../runtime/guide-view.service';
import { GuideVoiceService } from '../voice/guide-voice.service';
import { GuideThreadOpened } from '../contract/generated/guide-contract';
import { GuideThread } from '../entity/guide-thread.entity';
import { TrackEntrySource } from '../enum/guide.enum';
import { GuideSideQuestService } from '../runtime/guide-side-quest.service';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { guideDisabled } from '../guide-errors';
import {
  GUIDE_VISITOR_HEADER,
  GuideVisitorService,
} from '../visitor/guide-visitor.service';
import { TrackEnrollmentService } from 'src/track/service/track-enrollment.service';
import { DataSource } from 'typeorm';
import { GuideEventBusService } from '../runtime/guide-event-bus.service';
import { pipeThreadEvents, resumeSeq } from '../runtime/guide-sse';
import { GuideThreadService } from '../runtime/guide-thread.service';
import { GuideTurnService } from '../runtime/guide-turn.service';

/**
 * The learner side of the Ally guide (plans/ally-guide/plan.md §9.1). Turns
 * return `202 {turnId}`; everything the learner sees arrives on the thread's
 * SSE stream, which a reconnecting client resumes with `Last-Event-ID`.
 */
@ApiTags('Ally guide')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/guide')
export class GuideLearnerController {
  constructor(
    private readonly threads: GuideThreadService,
    private readonly turns: GuideTurnService,
    private readonly bus: GuideEventBusService,
    private readonly view: GuideViewService,
    private readonly cards: GuideCardService,
    private readonly trackEnrollment: TrackEnrollmentService,
    private readonly dataSource: DataSource,
    private readonly learnerData: GuideLearnerDataService,
    private readonly voice: GuideVoiceService,
    private readonly visitors: GuideVisitorService,
    private readonly sideQuests: GuideSideQuestService,
    private readonly releases: AgentReleaseService,
  ) {}

  @Post('threads/:threadId/voice-session')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({
    summary:
      "Start talking to Ally: a LiveKit room with the guide's voice worker dispatched into it",
  })
  async voiceSession(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: GuideVoiceSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    return this.voice.startSession(thread, user, dto);
  }

  @Get('memory')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary: 'What Ally remembers about the learner (theirs to see and delete)',
  })
  memory(@CurrentUser() user: TokenUser) {
    return this.learnerData.listMemories(user);
  }

  @Delete('memory/:memoryId')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({ summary: 'Forget one thing Ally remembered' })
  async forgetMemory(
    @Param('memoryId', ParseUUIDPipe) memoryId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.learnerData.forgetMemory(user, memoryId);
    return { forgotten: 1 };
  }

  @Delete('memory')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({ summary: 'Forget everything Ally remembered' })
  async forgetAllMemory(@CurrentUser() user: TokenUser) {
    return { forgotten: await this.learnerData.forgetAllMemories(user) };
  }

  @Get('notebook')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary: "The learner's notebook, optionally for one course",
  })
  async notebook(
    @CurrentUser() user: TokenUser,
    @Query('trackId') trackId?: string,
  ) {
    const rows = await this.learnerData.listNotebook(user, trackId);
    return rows.map((row) => ({
      id: row.id,
      trackId: row.trackId ?? null,
      kind: row.kind,
      text: row.text,
      createdAt: (row as any).createdAt ?? null,
    }));
  }

  @Get('notebook/export')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({ summary: 'The notebook as a Markdown document' })
  async exportNotebook(
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
    @Query('trackId') trackId?: string,
  ) {
    const markdown = await this.learnerData.exportNotebook(user, trackId);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="notebook.md"');
    res.send(markdown);
  }

  @Delete('notebook/:entryId')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({ summary: 'Delete a notebook entry' })
  async removeNotebookEntry(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.learnerData.removeFromNotebook(user, entryId);
    return { removed: 1 };
  }

  @Get('threads/:threadId/appointment')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({ summary: 'The time the learner chose to come back, if any' })
  async appointment(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    return { appointment: await this.learnerData.appointment(thread) };
  }

  @Put('threads/:threadId/appointment')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({
    summary:
      'Set the time to come back (ISO time + IANA zone); Ally sends one reminder then',
  })
  async setAppointment(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: GuideAppointmentDto,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    return this.learnerData.setAppointment(thread, user, dto);
  }

  @Delete('threads/:threadId/appointment')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({ summary: 'Cancel the reminder' })
  async cancelAppointment(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    await this.learnerData.cancelAppointment(thread);
    return { cancelled: true };
  }

  @Get('tracks/:trackId/bootstrap')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary:
      'Everything the journey needs to draw itself: availability, access, thread, Spine, recent messages, cards, prefs, next step',
  })
  bootstrap(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.view.bootstrap(trackId, user);
  }

  @Post('threads/:threadId/enroll')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({
    summary:
      'Enroll from the guided view (idempotent); same enrollment and progress as classic',
  })
  async enroll(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    // An existing enrollment keeps how the learner first arrived.
    const result = await this.trackEnrollment.enroll(
      thread.trackId,
      undefined,
      TrackEntrySource.GUIDED,
    );
    const bootstrap = await this.view.bootstrap(thread.trackId, user);
    if (bootstrap.spine) {
      await this.bus.appendDurable(thread.id, 'spine.updated', {
        currentItemId: bootstrap.spine.currentItemId,
        completedItems: bootstrap.spine.completed,
        totalItems: bootstrap.spine.total,
      });
    }
    return {
      ...result,
      spine: bootstrap.spine ?? null,
      nextStep: bootstrap.nextStep ?? null,
    };
  }

  @Post('threads/:threadId/cards/:cardId/events')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({
    summary:
      'What the learner did with a card; a completion claim is checked against classic progress',
  })
  async cardEvent(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: GuideCardEventDto,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    return this.cards.handle(thread, cardId, dto);
  }

  @Get('prefs')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({ summary: "The learner's own settings for Ally" })
  prefs(@CurrentUser() user: TokenUser) {
    return this.view.prefsFor(user);
  }

  @Put('prefs')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({ summary: 'Change any of the learner’s settings for Ally' })
  updatePrefs(
    @Body() dto: GuidePrefsUpdateDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.view.updatePrefs(user, dto);
  }

  @Post('tracks/:trackId/threads')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary: "The learner's thread for this course, created on first visit",
  })
  @ApiHeader({
    name: GUIDE_VISITOR_HEADER,
    required: false,
    description:
      'Sent once, right after signing in, to claim the visitor conversation (plan §3 stage 3)',
  })
  async openThread(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @CurrentUser() user: TokenUser,
    @Headers(GUIDE_VISITOR_HEADER) visitorToken?: string,
  ): Promise<GuideThreadOpened> {
    let thread: GuideThread;
    let claim: GuideThreadOpened['claim'];
    if (visitorToken) {
      const result = await this.visitors.claim(visitorToken, user, trackId);
      thread = result.thread;
      claim = result.outcome;
      if (claim !== 'none') {
        // Ally acknowledges the sign-in and carries on (plan §3 stage 3);
        // a merge's summary is already waiting in the same inbox.
        const signedIn = {
          dedupeKey: `signed_in:${visitorToken.slice(0, 16)}`,
          description:
            claim === 'claimed'
              ? 'The visitor has just signed in: this is now their own conversation, and their organisation and course progress are available. Acknowledge it in a few words, without fuss, and carry on where you were.'
              : 'The learner has just signed in and come back to their own conversation for this course. Welcome them back in a few words and carry on.',
        };
        await this.threads.queueTrigger(thread, {
          kind: 'signed_in',
          ...signedIn,
        });
        await this.turns.acceptTrigger(thread, user, {
          dedupeKey: `${thread.id}:${signedIn.dedupeKey}`,
          description: signedIn.description,
        });
      }
    } else {
      thread = await this.threads.getOrCreateForUser(trackId, user);
    }
    return {
      id: thread.id,
      trackId: thread.trackId,
      mode: thread.mode,
      atmosphere: atmosphereFor(thread.mode),
      lastEventSeq: thread.lastEventSeq,
      ...(claim ? { claim } : {}),
    };
  }

  @Post('threads/:threadId/turns')
  @HttpCode(202)
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({
    summary: 'Send a learner turn; the reply streams on /events',
  })
  async sendTurn(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: GuideTurnRequestDto,
    @CurrentUser() user: TokenUser,
    @Headers('traceparent') traceparent?: string,
    @Headers('tracestate') tracestate?: string,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    return this.turns.accept(thread, user, dto, { traceparent, tracestate });
  }

  @Post('threads/:threadId/micro-activities/:cardId/responses')
  @AuthPermissions([PERMISSIONS.EDIT_TRACK])
  @ApiOperation({
    summary:
      'Answer a side quest: marked against its key or given one Coach note. Ungraded — never affects progress or XP',
  })
  async answerMicroActivity(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: GuideMicroActivityResponseDto,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOwned(threadId, user);
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    if (!ga) throw guideDisabled();
    return this.sideQuests.respond({
      thread,
      cardId,
      answers: dto.answers,
      text: dto.text,
      languageCode: thread.languageCode ?? 'en',
      bundle: ga.bundle as unknown as GuideReleaseBundle,
      attribution: {
        threadId: thread.id,
        userId: user.id,
        tenantId: user.tenantId,
        releaseId: ga.id,
      },
    });
  }

  @Post('messages/:messageId/feedback')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary:
      "Thumbs up or down on one of Ally's messages (one per learner per message; sending again replaces it)",
  })
  async messageFeedback(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: GuideMessageFeedbackDto,
    @CurrentUser() user: TokenUser,
  ) {
    const rows: Array<{ threadId: string; role: string }> =
      await this.dataSource.query(
        `SELECT m."threadId", m."role" FROM "guide_messages" m WHERE m."id" = $1`,
        [messageId],
      );
    const message = rows[0];
    if (!message || message.role !== 'ally') {
      throw new NotFoundException('Message not found');
    }
    // Only on Ally's messages in the learner's own thread.
    await this.threads.getOwned(message.threadId, user);
    await this.dataSource.query(
      `INSERT INTO "guide_turn_feedback" ("messageId", "userId", "rating", "comment", "tenant_id")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("messageId", "userId")
       DO UPDATE SET "rating" = EXCLUDED."rating", "comment" = EXCLUDED."comment", "updatedAt" = now()`,
      [
        messageId,
        user.id,
        dto.rating,
        dto.comment?.trim() || null,
        user.tenantId,
      ],
    );
    return { messageId, rating: dto.rating };
  }

  @Get('threads/:threadId/messages')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary: 'A page of the transcript (for reload and scroll-back)',
  })
  async listMessages(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('beforeSeq') beforeSeq: string | undefined,
    @CurrentUser() user: TokenUser,
  ) {
    await this.threads.getOwned(threadId, user);
    const messages = await this.threads.listMessages(
      threadId,
      Number(beforeSeq) || undefined,
    );
    // Only what the learner may see: never the model-facing blocks.
    return messages.map((m) => ({
      id: m.id,
      seq: m.seq,
      role: m.role,
      kind: m.kind,
      channel: m.channel,
      text: m.content,
      turnId: m.turnId,
      createdAt: m.createdAt,
    }));
  }

  @Get('threads/:threadId/events')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary:
      'SSE: the thread event stream. Resume with the Last-Event-ID header (or ?afterSeq).',
  })
  async streamEvents(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('afterSeq') afterSeqQuery: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
    @CurrentUser() user: TokenUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const thread = await this.threads.getOwned(threadId, user);
    await pipeThreadEvents({
      bus: this.bus,
      cards: this.cards,
      thread,
      afterSeq: resumeSeq(lastEventId, afterSeqQuery),
      req,
      res,
      presence: true,
    });
  }
}
