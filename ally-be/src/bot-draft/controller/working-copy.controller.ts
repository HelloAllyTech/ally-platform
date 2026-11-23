import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  AssistantScope,
  ChatbotRole,
} from '../../chatbot/access/chatbot-role.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { answersOf } from '../templates/template-answers';
import { CopilotService } from '../copilot/copilot.service';
import {
  AddSourcesDto,
  ApplyTemplateDto,
  ApplyWorkingCopyDto,
  BuildModeDto,
  EditFieldDto,
} from '../dto/working-copy.dto';
import { BotDraftService } from '../service/bot-draft.service';
import { LibraryTemplateService } from '../templates/library-template.service';
import {
  CREDITS_GATE,
  creditsRequired,
  type CreditsGate,
} from '../working-copy/credits-gate';
import { settingsHash } from '../working-copy/staged-fields';
import {
  WorkingCopyService,
  type WorkingCopyContext,
} from '../working-copy/working-copy.service';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };

/**
 * Stage 3, Create and Build: every chatbot's working copy. Routes by draft id
 * (`/v1/bot-drafts/:id/...`) and, for a chatbot opened from the home, by chatbot id
 * (`/v1/chatbots/:id/working-copy/...`); the chatbot routes create the working copy from the
 * live chatbot when it has none. Every route checks the caller's role on the chatbot.
 */
@ApiTags('Onboarding')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1')
export class WorkingCopyController {
  constructor(
    private readonly workingCopy: WorkingCopyService,
    private readonly drafts: BotDraftService,
    private readonly templates: LibraryTemplateService,
    private readonly copilot: CopilotService,
    @Optional() @Inject(CREDITS_GATE) private readonly credits?: CreditsGate,
  ) {}

  // ── the working copy ───────────────────────────────────────────────────

  @Get('bot-drafts/:id/working-copy')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'The working copy: every field with its version, and whether it is live',
  })
  async view(@Param('id', ParseUUIDPipe) id: string) {
    return this.render(await this.workingCopy.forDraft(id));
  }

  @Get('chatbots/:id/working-copy')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'A chatbot’s working copy (created from the live chatbot when it has none)',
  })
  async viewForChatbot(@Param('id', ParseUUIDPipe) chatbotId: string) {
    return this.render(await this.workingCopy.forChatbot(chatbotId));
  }

  @Patch('bot-drafts/:id/fields/:field')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Edit one working-copy field (per-field version)',
    description:
      '`version` is the field’s version the edit started from. 409 `stale_field` when it changed since, and 400 (`safety_locked`, `invalid_draft`, `invalid_patch`, `unknown_field`) when refused; both carry `details: {field, value, version}` with the current value so the typed text can be kept. Edits to other fields never conflict. Returns `{field, value, version, settingsHash, staged}`; `staged` is true on a live chatbot (customers get it on Apply).',
  })
  async editField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('field') field: string,
    @Body() dto: EditFieldDto,
  ) {
    const ctx = await this.workingCopy.forDraft(id);
    return this.workingCopy.editField(ctx, field, dto.value, dto.version);
  }

  @Get('bot-drafts/:id/pending')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'What Apply would publish: field, live value, working value',
  })
  async pending(@Param('id', ParseUUIDPipe) id: string) {
    return this.workingCopy.pending(
      await this.workingCopy.forDraft(id, ChatbotMemberRole.VIEWER),
    );
  }

  @Get('chatbots/:id/working-copy/pending')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'The same as bot-drafts/:id/pending, by chatbot' })
  async pendingForChatbot(@Param('id', ParseUUIDPipe) chatbotId: string) {
    return this.workingCopy.pending(
      await this.workingCopy.forChatbot(chatbotId, ChatbotMemberRole.VIEWER),
    );
  }

  @Post('bot-drafts/:id/apply')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Apply the pending changes to the live chatbot',
    description:
      'Live chatbots only (409 `not_live` before go-live, when edits apply as you type). Runs the safety check only when a safety-relevant field changed (instructions, rules, languages, persona and tone, decline text, notes, sources); it fails closed: 422 `safety_conflict` or 503 `check_unavailable`, and nothing is written. At $0 the safety-relevant fields come back in `notApplied` with `credits_required` and the others apply. Returns `{applied, notApplied, warnings, liveVersion, pending}`.',
  })
  async apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyWorkingCopyDto,
  ) {
    return this.workingCopy.apply(
      await this.workingCopy.forDraft(id),
      dto?.fields,
    );
  }

  @Post('chatbots/:id/working-copy/apply')
  @HttpCode(200)
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'The same as bot-drafts/:id/apply, by chatbot' })
  async applyForChatbot(
    @Param('id', ParseUUIDPipe) chatbotId: string,
    @Body() dto: ApplyWorkingCopyDto,
  ) {
    return this.workingCopy.apply(
      await this.workingCopy.forChatbot(chatbotId),
      dto?.fields,
    );
  }

  @Post('bot-drafts/:id/mode')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Remember Copilot or the form for this chatbot; a chosen path touches a blank',
  })
  async mode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BuildModeDto,
  ) {
    const ctx = await this.workingCopy.forDraft(id);
    await this.drafts.setBuildMode(ctx.draft.id, dto.mode);
    if (dto.path) await this.drafts.touch(ctx.draft.id);
    return {
      mode: dto.mode,
      touched: Boolean(dto.path) || Boolean(ctx.draft.touchedAt),
    };
  }

  // ── templates ──────────────────────────────────────────────────────────

  @Get('bot-templates')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Ally template chatbots, each with its form fields',
  })
  catalogue() {
    return this.templates.catalogue();
  }

  @Post('bot-drafts/:id/template')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Start a blank chatbot from an Ally template',
    description:
      'Only while the chatbot is blank (409 `not_blank` otherwise). Copies the persona, rules, lists and setup answers into the working copy and each knowledge document as the chatbot’s own, queued for indexing at Ally’s cost. Works at $0. Returns `{applied: true, template, install, sourcesIndexing, documents, workingCopy}`.',
  })
  async template(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyTemplateDto,
  ) {
    const ctx = await this.workingCopy.forDraft(id, ChatbotMemberRole.OWNER);
    const { draft, ...result } = await this.templates.apply(
      ctx,
      dto.templateId,
      { ...answersOf(dto.answers), ...nameOf(dto.answers) },
    );
    return {
      ...result,
      workingCopy: this.render({ ...ctx, draft }),
    };
  }

  // ── sources and Copilot ────────────────────────────────────────────────

  @Post('bot-drafts/:id/sources')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Add web addresses or documents to a chatbot (also one that already has content)',
    description:
      'An address is read with the site crawl; a second one while a crawl runs waits its turn (`queued`). A crawl that fails at once comes back in `failure` as `{errorCode, message}`: `crawl_daily_limit`, `crawl_unreachable`, `crawl_needs_javascript`, `crawl_turned_away`, `crawl_blocked`, `crawl_little_found`, `crawl_failed`. On a live chatbot every new source waits for Apply (`staged: true`). Progress is narrated on /events as `narration {stage, text}`. 402 `credits_required` at $0.',
  })
  async addSources(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSourcesDto,
  ) {
    const ctx = await this.workingCopy.forDraft(id);
    await this.assertCredits(ctx);
    return this.copilot.addSources(ctx, dto as never);
  }

  @Get('bot-drafts/:id/sources')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'The crawl, its failure (as a code and a plain message) and the queue',
  })
  async sources(@Param('id', ParseUUIDPipe) id: string) {
    return this.copilot.sourcesView(await this.workingCopy.forDraft(id));
  }

  private async assertCredits(ctx: WorkingCopyContext): Promise<void> {
    if (
      this.credits &&
      !(await this.credits.creditsAvailable(ctx.chatbot.createdBy))
    ) {
      throw creditsRequired();
    }
  }

  private render(ctx: WorkingCopyContext) {
    const d = ctx.draft;
    return {
      draftId: d.id,
      chatbotId: d.chatbotId ?? null,
      live: ctx.live,
      blank: Boolean(d.blank),
      touched: Boolean(d.touchedAt),
      buildMode: d.buildMode ?? null,
      template: d.source?.template ?? null,
      fields: this.workingCopy.fields(d),
      settingsHash: settingsHash(
        d.draftConfig,
        d.source?.pendingDocumentIds ?? [],
      ),
      updatedAt: d.updatedAt ?? null,
    };
  }
}

/** The organisation's name from a template's form (kept beside the setup answers). */
function nameOf(raw: Record<string, unknown> | undefined): { name?: string } {
  const name = raw?.name;
  return typeof name === 'string' && name.trim()
    ? { name: name.trim().slice(0, 80) }
    : {};
}
