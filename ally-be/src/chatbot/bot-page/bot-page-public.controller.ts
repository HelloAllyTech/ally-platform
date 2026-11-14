import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators/auth.metadata';
import {
  BotPageFeedbackDto,
  BotPageIntakeDto,
  BotPageMessageDto,
  BotPageSessionDto,
  BotPageVerifyDto,
} from '../dto/bot-page.dto';
import type { AgentStreamEvent } from '../../ai/dto/knowledge.dto';
import { BotPagePublicService } from './bot-page-public.service';
import { BotPageVisitorService } from './bot-page-visitor.service';

/**
 * The bot page's public API (chunk 12b): what a visitor's browser calls. No dashboard auth; a
 * visitor is an httpOnly cookie (BotPageVisitorService). Browsers are answered only from the page's
 * own origin, and bodies are capped small (BotPageGuardMiddleware). A page that is off, a draft
 * bot, or a public page while public links are blocked all answer 404.
 */
@ApiTags('Bot page (public)')
@Controller('v1/public/bots')
export class BotPagePublicController {
  constructor(private readonly service: BotPagePublicService) {}

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'A bot page: branding, access mode, pre-chat and suggested questions',
  })
  async get(@Param('slug') slug: string) {
    return this.service.view(await this.service.page(slug));
  }

  @Public()
  @Post(':slug/embed/probe')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Website widget: set a throwaway cookie, to learn whether cookies get through',
    description:
      "Set exactly like the widget's visitor cookie (SameSite=None; Secure; Partitioned). The GET reads it back.",
  })
  async setProbe(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.service.page(slug);
    BotPageVisitorService.setProbe(res);
  }

  @Public()
  @Get(':slug/embed/probe')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Website widget: whether the probe cookie came back (if not, it asks for an in-memory token)',
  })
  async readProbe(
    @Param('slug') slug: string,
    @Req() req: Request,
  ): Promise<{ cookies: boolean }> {
    await this.service.page(slug);
    return { cookies: BotPageVisitorService.readProbe(req) };
  }

  @Public()
  @Post(':slug/session')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start or resume a visit',
    description:
      'Public pages: checks Turnstile (when configured) and sets the visitor cookie. Organisation and invite pages: with `email`, sends a code if that address may use the page, and answers the same either way.',
  })
  session(
    @Param('slug') slug: string,
    @Body() dto: BotPageSessionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.service.session(slug, dto, req, res);
  }

  @Public()
  @Post(':slug/otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check the emailed code (10 minutes, 5 tries)' })
  verify(
    @Param('slug') slug: string,
    @Body() dto: BotPageVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.service.verify(slug, dto, req, res);
  }

  @Public()
  @Post(':slug/intake')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save the pre-chat answers on the conversation' })
  intake(
    @Param('slug') slug: string,
    @Body() dto: BotPageIntakeDto,
    @Req() req: Request,
  ) {
    return this.service.intake(slug, dto, req);
  }

  @Public()
  @Get(':slug/conversation')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The open conversation, so a reload resumes it' })
  conversation(@Param('slug') slug: string, @Req() req: Request) {
    return this.service.conversation(slug, req);
  }

  @Public()
  @Post(':slug/conversation/new')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close the open conversation; the next message starts a new one',
  })
  newConversation(@Param('slug') slug: string, @Req() req: Request) {
    return this.service.newConversation(slug, req);
  }

  @Public()
  @Post(':slug/handover')
  @ApiOperation({
    summary: 'Talk to a person: ask the team to join this chat (chunk 11a)',
    description:
      'The same hand-over as asking in words. Returns the message the visitor is shown.',
  })
  askForPerson(@Param('slug') slug: string, @Req() req: Request) {
    return this.service.askForPerson(slug, req);
  }

  @Get(':slug/conversation/events')
  @ApiOperation({
    summary:
      "The visitor's live stream (SSE): a team member's replies and changes of hands",
    description:
      'Starts with `hello` {conversationId, by: assistant|person}, so a reconnect knows who has the chat; then `message` {id, role, text, sender, createdAt} and `state` {by}. Ends at once when there is no chat yet. A comment line every 10 s.',
  })
  visitorStream(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.service.visitorStream(slug, req, res);
  }

  @Post(':slug/messages/:messageId/feedback')
  @ApiOperation({
    summary: 'Was this helpful? A thumbs up or down on one answer (changeable)',
    description:
      'Only the visitor whose conversation it is may rate it. Crisis replies, templates and the consent gate cannot be rated (409 not_rateable).',
  })
  feedback(
    @Param('slug') slug: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: BotPageFeedbackDto,
    @Req() req: Request,
  ) {
    return this.service.feedback(slug, messageId, dto, req);
  }

  @Post(':slug/messages/stream')
  @ApiOperation({
    summary: 'Send a message and stream the reply (SSE)',
    description:
      'Events: status {code}, token {text} (only once the checks have cleared it), then final {reply, citations, messageId, conversationId}, or error {code}. Refusals before the reply starts (rate limit, busy, pre-chat questions unanswered) are plain HTTP errors with a `code`. Steps and run details never reach the page.',
  })
  async stream(
    @Param('slug') slug: string,
    @Body() dto: BotPageMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Everything that can refuse runs first, so a refusal is a plain HTTP error the page can read.
    const admitted = await this.service.admit(slug, dto.message, req, res);

    const stop = new AbortController();
    let heartbeat: NodeJS.Timeout | undefined;
    res.on('close', () => {
      if (!res.writableEnded) stop.abort();
    });
    const send = (event: string, data: unknown): void => {
      if (stop.signal.aborted || res.writableEnded) return;
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        heartbeat = setInterval(() => res.write(': ping\n\n'), 10_000);
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const final = await this.service.respond(admitted, {
        onEvent: (event) => {
          const visible = publicEvent(event);
          if (visible) send(visible.event, visible.data);
        },
        signal: stop.signal,
      });
      send('final', final);
    } catch (error) {
      if (!res.headersSent && !stop.signal.aborted) throw error;
      send('error', { code: 'internal' });
    } finally {
      clearInterval(heartbeat);
      if (res.headersSent && !res.writableEnded) res.end();
    }
  }
}

/**
 * What a visitor may see of a run: what it is doing (`status`, as a code the page words itself) and
 * the checked reply text. Never `run_started` (the run id), `step` (the trace), or a status's
 * `detail` and `documents` (search queries and document titles).
 */
export function publicEvent(
  event: AgentStreamEvent,
): { event: 'status' | 'token'; data: Record<string, string> } | null {
  switch (event.event) {
    case 'status':
      return { event: 'status', data: { code: event.data.code } };
    case 'token':
      return { event: 'token', data: { text: event.data.text } };
    default:
      return null;
  }
}
