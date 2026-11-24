import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
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
import { ONBOARDING_COPY } from '../copy/onboarding-copy';
import { displayDomain, startUrlFrom } from '../crawl/url-scope';
import { SiteCrawlService } from '../crawl/site-crawl.service';
import {
  AddBotDraftDocumentDto,
  BotDraftMessageDto,
  CreateBotDraftDto,
  DescribeBotDraftDto,
  PatchBotDraftDto,
  CorrectBotDraftPackDto,
  PublishBotDraftDto,
  UndoBotDraftDto,
  PageChoiceDto,
} from '../dto/bot-draft.dto';
import { BotDraftActor, BotDraftStatus } from '../enum/bot-draft.enum';
import { TestChatbotDto } from '../../chatbot/dto/chatbot.dto';
import { BotDraftPreviewService } from '../service/bot-draft-preview.service';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';
import { BotDraftSessionService } from '../service/bot-draft-session.service';
import { draftView } from '../service/bot-draft-view';
import { BotDraftEventsService } from '../service/bot-draft-events.service';
import { BotDraftService } from '../service/bot-draft.service';
import { DraftCheckupService } from '../checkup/draft-checkup.service';
import { CheckupCasesService } from '../checkup/checkup-cases.service';
import { SourcesService } from '../home/sources.service';
import { SseWriter } from './sse';
import { templateById } from '../../chatbot/templates/templates';
import { answersOf, templateDescription } from '../templates/template-answers';
import { TemplateService } from '../templates/template.service';
import { AssistantScope } from '../../chatbot/access/chatbot-role.decorator';
import { BlankChatbotService } from '../blank/blank-chatbot.service';
import { WorkingCopyService } from '../working-copy/working-copy.service';
import { GoLiveGateService } from '../../chatbot/safety/go-live-gate.service';

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
    private readonly checkup: DraftCheckupService,
    private readonly sources: SourcesService,
    // Optional so the specs that build this controller by hand needn't change.
    private readonly checkupCases?: CheckupCasesService,
    // Use-case templates (T1); optional for the same reason.
    @Optional() private readonly templates?: TemplateService,
    // SB1: chat with the assistant while building it.
    @Optional() private readonly preview?: BotDraftPreviewService,
    // Stage 3: blank chatbots and the working copy.
    @Optional() private readonly blanks?: BlankChatbotService,
    @Optional() private readonly workingCopy?: WorkingCopyService,
    // Stage 4: while the go-live gate is on it is the readiness check, not the old Check-up run.
    @Optional() private readonly goLive?: GoLiveGateService,
  ) {}

  @Post()
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Start setting up an assistant, from a website, documents, a description or an interview',
    description:
      'Creates the draft and its draft chatbot. With a website, reading starts in the background (progress on /events); with a description, its details are read into "What we learned"; with `interview`, the builder opens by asking its first question and learns from the owner\'s answers in chat.',
  })
  async create(@Body() dto: CreateBotDraftDto) {
    // Stage 3: no input at all (or `blank: true`) creates a blank chatbot at the click, reusing the
    // caller's newest untouched one, so a double click makes one.
    if (this.blanks && isBlankRequest(dto)) {
      const { draft, reused } = await this.blanks.createOrReuse();
      return { ...draftView(draft), blank: true, reused };
    }
    const website = dto.website?.trim();
    // T1: a template start reads a description written from the owner's answers.
    const template = dto.template ? templateById(dto.template) : undefined;
    if (dto.template && !template) {
      throw new BadRequestException({
        errorCode: 'unknown_template',
        message: 'That template isn’t available.',
      });
    }
    const answers = answersOf(dto.answers);
    const description =
      dto.description?.trim() ||
      (template && !website
        ? templateDescription(template, answers, dto.name)
        : undefined);
    if (!website && !description && !dto.upload && !dto.interview) {
      throw new BadRequestException(
        'Paste your website, upload documents, describe your business, or choose the interview.',
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
      name: start
        ? nameFromDomain(displayDomain(start))
        : dto.name?.trim() || 'Your business',
      website: start,
      description: description ?? null,
      interview: !!dto.interview && !start && !description,
    });
    const withOwner = await this.drafts.appendTranscript(draft, [
      {
        role: 'builder',
        text:
          dto.interview && !start && !description
            ? ONBOARDING_COPY.interviewOpening
            : ONBOARDING_COPY.opening,
      },
      ...(start || description
        ? [{ role: 'owner' as const, text: start ?? description! }]
        : []),
    ]);
    if (template && this.templates) {
      // Before reading starts: the template's pack and purpose are in place, and reading can only
      // make the pack stricter.
      await this.templates.installOnDraft(withOwner, template.id, answers);
    }
    if (start) {
      await this.crawl.start(withOwner);
    } else if (description) {
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

  @Post(':id/documents')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Read an uploaded document into "What we learned"',
    description:
      "For a document already uploaded to the draft's chatbot (POST /v1/chatbots/:id/documents/upload-url, then /documents/private). Read in the background, a page at a time; each detail is sourced to the document and page. Progress on /events.",
  })
  async addDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddBotDraftDocumentDto,
  ) {
    const draft = await this.drafts.get(id);
    // "Reading your documents…" from the first view the page gets back (Q3-fast).
    await this.session.startReading(draft.id, dto.documentId);
    void this.session
      .learnFromDocument(draft.id, dto.documentId)
      .catch((error) =>
        this.logger.warn(
          `Reading document ${dto.documentId} for draft ${id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
    return draftView((await this.drafts.findById(draft.id)) ?? draft);
  }

  @Post(':id/description')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Read a description into "What we learned"',
    description:
      'For a setup whose website gave too little: the description is read in the background, each detail sourced to the owner, as when a setup starts from one. Progress on /events.',
  })
  async describe(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DescribeBotDraftDto,
  ) {
    const draft = await this.drafts.get(id);
    void this.session
      .learnFromDescription(draft.id, dto.description.trim())
      .catch((error) =>
        this.logger.warn(
          `Reading the description for draft ${id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
    return draftView(draft);
  }

  @Get('current')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'The caller’s setup in progress, if any (the resume banner)',
  })
  async current() {
    const draft = await this.drafts.current();
    return { draft: draft ? draftView(draft) : null };
  }

  @Get(':id')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return draftView(await this.drafts.get(id));
  }

  @Get(':id/events')
  @AssistantScope('service')
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
  @AssistantScope('service')
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
  @AssistantScope('service')
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
  @AssistantScope('service')
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
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Go back a step; answers and edits are kept' })
  async back(@Param('id', ParseUUIDPipe) id: string) {
    return draftView(await this.drafts.back(await this.drafts.get(id)));
  }

  @Post(':id/pack')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      '"This isn\'t right for my business": choose the safety pack in setup (Q4 A3)',
    description:
      "Stricter at once; less strict only with the owner's reason (reason_required), recorded with the change and kept on the assistant when it is published.",
  })
  async correctPack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectBotDraftPackDto,
  ) {
    const draft = await this.drafts.get(id);
    return draftView(
      await this.drafts.correctPack(draft, dto.pack, dto.reason ?? null),
    );
  }

  @Post(':id/publish')
  @AssistantScope('service')
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
    const draft = await this.drafts.get(id);
    // Stage 4 (D10): with the go-live gate on, its per-language crisis check (asserted inside
    // `publisher.publish`) is the hard gate and the owner decides the rest; the Check-up stays
    // available but no longer blocks going live. With the gate switched off
    // (ASSISTANT_GO_LIVE_GATE_ENABLED=false) the old rule holds: the checkup gates the first
    // publish (chunk 20a-2), and changing who can use a published assistant doesn't run it again.
    if (!this.goLive?.enforced() && draft.status !== BotDraftStatus.PUBLISHED) {
      // An owner's own Must pass question that failed asks first (chunk 20d-2); the gate itself
      // (unsourced answers, safety questions) is unchanged and runs after.
      await this.checkupCases?.assertMustPassConfirmed(
        draft,
        Boolean(dto.confirmMustPass),
      );
      await this.checkup.assertCanPublish(
        draft,
        Boolean(dto.publishAnyway),
        Boolean(dto.recheckSafety),
      );
    }
    const published = await this.publisher.publish(draft, dto);
    // Stage 3: from now on the working copy waits for Apply. Publishing again changes nothing here.
    if (draft.status !== BotDraftStatus.PUBLISHED) {
      await this.workingCopy
        ?.markLive(draft.id)
        .catch((error) =>
          this.logger.warn(
            `Working copy not marked live for draft ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        );
    }
    return published;
  }

  @Get(':id/pages/found')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'The site’s pages found so far, grouped by section (none are read)',
  })
  foundPages(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.found(id);
  }

  @Post(':id/pages')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Choose which pages it reads',
    description:
      'Saved on the draft and reused when the site is read again. Pages already read that the choice leaves out are taken away, with the details that came only from them; the result names the event that undoes it.',
  })
  choosePages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PageChoiceDto,
  ) {
    return this.sources.choose(id, dto);
  }

  @Post(':id/pages/:eventId/undo')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Put back the pages a choice took away' })
  undoPages(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.sources.restoreForDraft(id, eventId);
  }

  @Post(':id/checkup')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Run the checkup on the assistant this setup built',
    description:
      'Writes its questions (keeping the owner’s and the platform’s) and starts a run; poll GET /v1/chatbots/:chatbotId/checkup/runs/:runId.',
  })
  runCheckup(@Param('id', ParseUUIDPipe) id: string) {
    return this.checkup.runForDraft(id);
  }

  @Post(':id/abandon')
  @AssistantScope('service')
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

  // ── SB1: chat with the assistant while building it ───────────────────────

  @Post(':id/test')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Ask the assistant being built a question, using the draft as it is now',
    description:
      "Projects the latest draft onto its draft assistant, then runs the ordinary Preview test (same decision path and crisis check as /v1/chatbots/:id/test). Any `draft` override in the body is ignored: the server's draft is the truth. 409 `setup_finished` once the setup is published or abandoned. The reply carries `preview.pendingDocuments`.",
  })
  test(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TestChatbotDto) {
    return this.previewService().test(id, dto);
  }

  @Post(':id/test/stream')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'The same test as :id/test, streamed (SSE)',
    description:
      'Events as /v1/chatbots/:id/test/stream: run_started, status, step, token, then final (what :id/test returns) or error. Closing the connection stops the run.',
  })
  async testStream(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestChatbotDto,
    @Res() res: Response,
  ): Promise<void> {
    const preview = this.previewService();
    const stop = new AbortController();
    let heartbeat: NodeJS.Timeout | undefined;
    res.on('close', () => {
      if (!res.writableEnded) stop.abort();
    });
    // Headers go out with the first event, so a refusal before the run (no access, a finished
    // setup) is still a plain HTTP error the dashboard can read.
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
      const result = await preview.test(id, dto, {
        onEvent: ({ event, data }) => send(event, data),
        signal: stop.signal,
      });
      send('final', result);
    } catch (error) {
      if (!res.headersSent) throw error;
      send('error', { code: 'internal' });
    } finally {
      clearInterval(heartbeat);
      if (res.headersSent && !res.writableEnded) res.end();
    }
  }

  /** Optional in the constructor so specs that build this controller by hand needn't change. */
  private previewService(): BotDraftPreviewService {
    if (!this.preview)
      throw new Error('BotDraftPreviewService is not provided');
    return this.preview;
  }
}

/** Stage 3: a create with nothing to start from, or an explicit blank. */
function isBlankRequest(dto: CreateBotDraftDto | undefined): boolean {
  if (!dto) return true;
  if (dto.blank === true) return true;
  return (
    !dto.website?.trim() &&
    !dto.description?.trim() &&
    !dto.upload &&
    !dto.interview &&
    !dto.template
  );
}

/** "sunrise-mind.example" → "Sunrise Mind": a starting name the owner can change. */
function nameFromDomain(domain: string): string {
  const label = domain.replace(/^www\./, '').split('.')[0] ?? domain;
  const words = label.split(/[-_]+/).filter(Boolean);
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return name || domain;
}
