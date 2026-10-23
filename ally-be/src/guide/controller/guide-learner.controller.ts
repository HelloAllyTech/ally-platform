import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { GuideEvent } from '../contract/generated/guide-contract';
import {
  atmosphereFor,
  GUIDE_SSE_PING_INTERVAL_MS,
} from '../constants/guide.constants';
import { GuideTurnRequestDto } from '../dto/guide.dto';
import {
  GuideEventBusService,
  GuideReplayGate,
} from '../runtime/guide-event-bus.service';
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
  ) {}

  @Post('tracks/:trackId/threads')
  @AuthPermissions([PERMISSIONS.VIEW_TRACK])
  @ApiOperation({
    summary: "The learner's thread for this course, created on first visit",
  })
  async openThread(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const thread = await this.threads.getOrCreateForUser(trackId, user);
    return {
      id: thread.id,
      trackId: thread.trackId,
      mode: thread.mode,
      atmosphere: atmosphereFor(thread.mode),
      lastEventSeq: thread.lastEventSeq,
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
    const afterSeq = Math.max(
      0,
      Number(lastEventId ?? afterSeqQuery ?? 0) || 0,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    const gate = new GuideReplayGate(afterSeq);
    const write = (event: GuideEvent): void => {
      if (closed || res.writableEnded || !gate.accept(event)) return;
      const id = event.durable ? `id: ${event.seq}\n` : '';
      res.write(
        `event: ${event.type}\n${id}data: ${JSON.stringify(event)}\n\n`,
      );
    };

    // Subscribe BEFORE replaying, buffering live events, so nothing published
    // between the replay query and going live is lost (plan §9.2).
    const buffered: GuideEvent[] = [];
    let live = false;
    const unsubscribe = this.bus.subscribe(threadId, (event) =>
      live ? write(event) : buffered.push(event),
    );
    const heartbeat = setInterval(() => {
      void this.bus
        .emitEphemeral(threadId, 'ping', {}, gate.lastSeq)
        .catch(() => undefined);
    }, GUIDE_SSE_PING_INTERVAL_MS);
    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });

    try {
      await this.bus.ensureSubscribed();
      write({
        v: 1,
        seq: afterSeq,
        threadId,
        at: new Date().toISOString(),
        durable: false,
        type: 'hello',
        data: {
          lastSeq: thread.lastEventSeq,
          mode: thread.mode,
          atmosphere: atmosphereFor(thread.mode),
        },
      });
      for (const event of await this.bus.replay(threadId, afterSeq))
        write(event);
      live = true;
      for (const event of buffered.splice(0)) write(event);
    } catch {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
  }
}
