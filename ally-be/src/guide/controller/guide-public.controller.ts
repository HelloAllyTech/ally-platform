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
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from 'src/auth/decorators/auth.metadata';
import { atmosphereFor } from '../constants/guide.constants';
import {
  GuideThreadOpened,
  GuideVisitorCreated,
} from '../contract/generated/guide-contract';
import { GuideTurnRequestDto } from '../dto/guide.dto';
import { GuideCardService } from '../runtime/guide-card.service';
import { GuideEventBusService } from '../runtime/guide-event-bus.service';
import { pipeThreadEvents, resumeSeq } from '../runtime/guide-sse';
import { GuideTurnService } from '../runtime/guide-turn.service';
import { GuideViewService } from '../runtime/guide-view.service';
import {
  GUIDE_VISITOR_HEADER,
  GuideVisitorService,
} from '../visitor/guide-visitor.service';

/**
 * Signed-out endpoints (plans/ally-guide/plan.md §9.1).
 *
 * `availability` is what the learner app's `/course/:id` gate asks before
 * redirecting to `/journey/:id` (plan §5.14): any "no" means the classic
 * landing page.
 *
 * The rest are an anonymous visitor's conversation on a public course link
 * (§3 stages 1–2): create a visitor, then bootstrap, open a thread, send
 * turns and stream events with its token in the `x-guide-visitor` header.
 * Every route fails closed when anonymous chat is off. Signing in claims the
 * conversation through the signed-in `POST tracks/:trackId/threads`.
 */
@ApiTags('Ally guide')
@Controller('v1/guide/public')
export class GuidePublicController {
  constructor(
    private readonly view: GuideViewService,
    private readonly visitors: GuideVisitorService,
    private readonly turns: GuideTurnService,
    private readonly bus: GuideEventBusService,
    private readonly cards: GuideCardService,
  ) {}

  @Get('availability/:trackId')
  @Public()
  @ApiOperation({
    summary:
      'Whether the guided experience is on for this course, its languages, and why not',
  })
  availability(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.view.availability(trackId);
  }

  @Post('visitors')
  @Public()
  @ApiOperation({
    summary:
      'Start an anonymous visit: a token the browser keeps (only its hash is stored)',
  })
  async createVisitor(@Req() req: Request): Promise<GuideVisitorCreated> {
    const { token } = await this.visitors.create(
      req.ip,
      await this.visitors.policy(),
    );
    return { token };
  }

  @Get('tracks/:trackId/bootstrap')
  @Public()
  @ApiHeader({ name: GUIDE_VISITOR_HEADER, required: false })
  @ApiOperation({
    summary:
      "A visitor's journey: availability, the course preview, their conversation and allowance",
  })
  async bootstrap(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Headers(GUIDE_VISITOR_HEADER) token?: string,
  ) {
    const visitor = token ? await this.visitors.resolve(token) : null;
    return this.view.bootstrapForVisitor(
      trackId,
      visitor,
      (visitorId, policy) =>
        this.visitors.allowance(visitorId, trackId, policy),
    );
  }

  @Post('tracks/:trackId/threads')
  @Public()
  @ApiHeader({ name: GUIDE_VISITOR_HEADER, required: true })
  @ApiOperation({
    summary: "The visitor's thread for this course, created on first message",
  })
  async openThread(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @Headers(GUIDE_VISITOR_HEADER) token: string,
  ): Promise<GuideThreadOpened> {
    const visitor = await this.visitors.resolve(token);
    const thread = await this.visitors.threadFor(visitor, trackId);
    return {
      id: thread.id,
      trackId: thread.trackId,
      mode: thread.mode,
      atmosphere: atmosphereFor(thread.mode),
      lastEventSeq: thread.lastEventSeq,
    };
  }

  @Post('threads/:threadId/turns')
  @Public()
  @HttpCode(202)
  @ApiHeader({ name: GUIDE_VISITOR_HEADER, required: true })
  @ApiOperation({
    summary:
      "A visitor's turn; the reply streams on /events. Over the allowance it fails with allowance_exhausted",
  })
  async sendTurn(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: GuideTurnRequestDto,
    @Headers(GUIDE_VISITOR_HEADER) token: string,
    @Req() req: Request,
  ) {
    const visitor = await this.visitors.resolve(token);
    const thread = await this.visitors.getOwned(threadId, visitor.id);
    return this.turns.acceptVisitor(
      thread,
      visitor,
      dto,
      this.visitors.hashIp(req.ip),
    );
  }

  @Get('threads/:threadId/events')
  @Public()
  @ApiHeader({ name: GUIDE_VISITOR_HEADER, required: true })
  @ApiOperation({
    summary:
      "SSE: a visitor's thread events. Resume with the Last-Event-ID header (or ?afterSeq).",
  })
  async streamEvents(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('afterSeq') afterSeqQuery: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Headers(GUIDE_VISITOR_HEADER) token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const visitor = await this.visitors.resolve(token);
    const thread = await this.visitors.getOwned(threadId, visitor.id);
    await pipeThreadEvents({
      bus: this.bus,
      cards: this.cards,
      thread,
      afterSeq: resumeSeq(lastEventId, afterSeqQuery),
      req,
      res,
      // Nothing on the platform happens to a visitor: no presence needed.
      presence: false,
    });
  }
}
