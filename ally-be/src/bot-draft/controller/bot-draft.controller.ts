import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { AiUpstreamError } from '../../ai/exception/ai-upstream.exception';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ONBOARDING_COPY } from '../copy/onboarding-copy';
import { displayDomain, startUrlFrom } from '../crawl/url-scope';
import { SiteCrawlService } from '../crawl/site-crawl.service';
import {
  BotDraftMessageDto,
  CreateBotDraftDto,
  PatchBotDraftDto,
  PublishBotDraftDto,
  UndoBotDraftDto,
} from '../dto/bot-draft.dto';
import { BotDraftActor, BotDraftStatus } from '../enum/bot-draft.enum';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';
import { BotDraftSessionService } from '../service/bot-draft-session.service';
import { changes, draftView } from '../service/bot-draft-view';
import { BotDraftEventsService } from '../service/bot-draft-events.service';
import { BotDraftService } from '../service/bot-draft.service';
import { SseWriter } from './sse';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * Agent-first onboarding (chunk 20a): an owner sets up an assistant by talking to the builder.
 * Open to anyone with AI Chatbots and its edit permission (Shehbaz, 2026-11-07); a draft is
 * visible to its owner (and platform admins) only.
 */
@ApiTags('Onboarding')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/bot-drafts')
export class BotDraftController {
  private readonly logger = LoggerService.getInstance(BotDraftController.name);

  constructor(
    private readonly drafts: BotDraftService,
    private readonly session: BotDraftSessionService,
    private readonly crawl: SiteCrawlService,
    private readonly publisher: BotDraftPublishService,
    private readonly events: BotDraftEventsService,
  ) {}

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Start setting up an assistant, from a website or a description',
    description:
      'Creates the draft and its draft chatbot. With a website, reading starts in the background (progress on /events); with a description, its details are read into "What we learned".',
  })
  async create(@Body() dto: CreateBotDraftDto) {
    const website = dto.website?.trim();
    const description = dto.description?.trim();
    if (!website && !description) {
      throw new BadRequestException(
        'Paste your website, or describe your business.',
      );
    }
    let start: string | null = null;
    if (website) {
      start = startUrlFrom(website);
      if (!start) {
        throw new BadRequestException({
          errorCode: 'invalid_website',
          message: 'That doesn’t look like a website address.',
        });
      }
    }
    const draft = await this.drafts.create({
      name: start ? nameFromDomain(displayDomain(start)) : 'Your business',
      website: start,
      description: description ?? null,
    });
    const withOwner = await this.drafts.appendTranscript(draft, [
      { role: 'builder', text: ONBOARDING_COPY.opening },
      { role: 'owner', text: start ?? description! },
    ]);
    if (start) {
      await this.crawl.start(withOwner);
    } else {
      // In the background: the canvas fills as the details arrive.
      void this.session
        .learnFromDescription(draft.id, description!)
        .catch((error) =>
          this.logger.warn(
            `Reading the description for draft ${draft.id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        );
    }
    return draftView((await this.drafts.findById(draft.id)) ?? withOwner);
  }

  @Get('current')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'The caller’s setup in progress, if any (the resume banner)',
  })
  async current() {
    const draft = await this.drafts.current();
    return { draft: draft ? draftView(draft) : null };
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return draftView(await this.drafts.get(id));
  }

  @Get(':id/events')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Live canvas events (SSE)',
    description:
      'Starts with `state` (the whole draft, so a reconnect redraws from it), then crawl progress (`reading`, `page`, `finding`, `brand`, `done`), `message`, `patched`, `step`, `safety`, `draft` and `published` as they happen. A comment line every 10 s.',
  })
  async stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const draft = await this.drafts.get(id);
    const sse = new SseWriter(res);
    sse.send('state', draftView(draft));
    const stop = await this.events.listen(id, (event) => {
      const { type, ...data } = event as { type: string };
      sse.send(type, data);
    });
    await new Promise<void>((resolve) =>
      sse.closed.signal.addEventListener('abort', () => resolve()),
    );
    stop();
    sse.end();
  }

  @Post(':id/messages/stream')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Send the builder a message or quick reply (SSE)',
    description:
      'Events: `status` while the builder works, `message` for any line ally-be adds (the safety pack’s own words), the reply as `token`s, then `final` {message, step, questionsLeft, version, draft}. Changes it proposes are applied (and checked) before any reply text is sent. Refusals before the stream are plain HTTP errors; a failure after it starts is `error {code: "generic", message}`.',
  })
  async message(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BotDraftMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    const draft = await this.drafts.get(id);
    const sse = new SseWriter(res);
    try {
      const result = await this.session.turn(
        draft,
        { text: dto.text, chip: dto.chip },
        ({ event, data }) => sse.send(event, data),
        sse.closed.signal,
      );
      sse.send('final', {
        message: result.message,
        step: result.step,
        questionsLeft: result.questionsLeft,
        version: result.version,
        draft: draftView(result.draft),
      });
    } catch (error) {
      if (!sse.started && !(error instanceof AiUpstreamError)) throw error;
      this.logger.warn(
        `Builder turn for draft ${id} failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`,
      );
      sse.send('error', {
        code: 'generic',
        message: ONBOARDING_COPY.problems.generic,
      });
    } finally {
      sse.end();
    }
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Edit the draft on the canvas (a JSON Patch)',
    description:
      'Checked like the builder’s changes: allowed paths, the draft schema, and the safety lock (`safety_locked` for anything that weakens the pack). `version` must be current (409 `stale_version` otherwise).',
  })
  async patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchBotDraftDto,
  ) {
    const draft = await this.drafts.get(id);
    const { draft: saved, event } = await this.drafts.applyPatch(
      draft,
      dto.ops as never,
      BotDraftActor.OWNER,
      { target: dto.target, expectedVersion: dto.version },
    );
    // The chat notes the owner's edit ("Updated your hours"), as the brief asks.
    const noted = await this.drafts.appendTranscript(saved, [
      { role: 'note', text: event.summary },
    ]);
    await this.events.publish(id, {
      type: 'message',
      entry: noted.transcript[noted.transcript.length - 1],
    });
    return draftView(noted);
  }

  @Post(':id/undo')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  async undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoBotDraftDto,
  ) {
    return draftView(
      await this.drafts.undo(await this.drafts.get(id), dto.eventId),
    );
  }

  @Post(':id/back')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Go back a step; answers and edits are kept' })
  async back(@Param('id', ParseUUIDPipe) id: string) {
    return draftView(await this.drafts.back(await this.drafts.get(id)));
  }

  @Post(':id/publish')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Publish the assistant with its bot page',
    description:
      'Idempotent: publishing again converges the same chatbot, page and access list. Public is refused while the platform’s botPagePublicAllowed is off.',
  })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishBotDraftDto,
  ) {
    return this.publisher.publish(await this.drafts.get(id), dto);
  }

  @Post(':id/abandon')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Leave this setup for good (its draft assistant stays a draft)',
  })
  async abandon(@Param('id', ParseUUIDPipe) id: string) {
    const draft = await this.drafts.get(id);
    if (draft.status !== BotDraftStatus.ACTIVE) return draftView(draft);
    return draftView(
      await this.drafts.update(draft, { status: BotDraftStatus.ABANDONED }),
    );
  }
}

/** A chatbot's change history, from the draft that built it (20a-2 shows it with Undo). */
@ApiTags('Onboarding')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
export class ChatbotChangesController {
  constructor(
    private readonly drafts: BotDraftService,
    private readonly access: ChatbotAccessService,
  ) {}

  @Get(':id/changes')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  async changes(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id, ChatbotMemberRole.VIEWER);
    const draft = await this.drafts.findByChatbot(id);
    return { changes: draft ? changes(draft.events) : [] };
  }
}

/** "sunrise-mind.example" → "Sunrise Mind": a starting name the owner can change. */
export function nameFromDomain(domain: string): string {
  const label = domain.replace(/^www\./, '').split('.')[0] ?? domain;
  const words = label.split(/[-_]+/).filter(Boolean);
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return name || domain;
}
