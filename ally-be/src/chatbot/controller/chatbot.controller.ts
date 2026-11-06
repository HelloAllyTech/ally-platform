import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  AddChatbotAudienceDto,
  CreateChatbotDto,
  SetChatbotDocumentsDto,
  SetChatbotMembersDto,
  SetChatbotStatusDto,
  TestChatbotDto,
  UpdateChatbotDto,
  UpdateChatbotSettingsDto,
} from '../dto/chatbot.dto';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { CHATBOT_SECTIONS } from '../sections/chatbot-sections';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { ChatbotAudienceService } from '../service/chatbot-audience.service';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import {
  CreateKbOwnedDocumentDto,
  CreateKbUploadUrlDto,
} from '../../knowledge-base/dto/knowledge-base.dto';
import { ChatbotService } from '../service/chatbot.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * Chatbots. Every route is @CallerScopedRoute: what a caller sees is decided by their membership of
 * each bot (ChatbotAccessService), not by an organisation in the query, so an organisation-
 * restricted admin reaches exactly the bots they were added to.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class ChatbotController {
  constructor(
    private readonly chatbots: ChatbotService,
    private readonly access: ChatbotAccessService,
    private readonly audience: ChatbotAudienceService,
    private readonly settings: ChatbotSettingsService,
  ) {}

  @Get('sections')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'The configurable sections of a chatbot' })
  sections() {
    return CHATBOT_SECTIONS;
  }

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      'Chatbots you can see, with their connectors and last-30-day activity',
  })
  async list() {
    return {
      chatbots: await this.chatbots.list(),
      canCreate: await this.access.isPlatformAdmin(),
    };
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Create a chatbot (platform admins). It starts as a draft.',
  })
  create(@Body() dto: CreateChatbotDto) {
    return this.chatbots.create(dto);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatbots.get(id);
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Change name, persona, modes or model' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatbotDto,
  ) {
    return this.chatbots.update(id, dto);
  }

  @Patch(':id/status')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Go live, pause, or back to draft' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetChatbotStatusDto,
  ) {
    return this.chatbots.setStatus(id, dto.status);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Archive a chatbot; its connectors are freed for another bot',
  })
  async archive(@Param('id', ParseUUIDPipe) id: string) {
    await this.chatbots.archive(id);
  }

  // ── settings ──────────────────────────────────────────────────────────

  @Get(':id/settings')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'Defaults, this bot’s changes, and the result' })
  async getSettings(@Param('id', ParseUUIDPipe) id: string) {
    const { chatbot } = await this.access.assert(id);
    return this.settings.getChatbotView(chatbot);
  }

  @Put(':id/settings')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Replace this bot’s changes to the defaults',
    description:
      'Send every field the bot changes; one left out follows the default. Safety and rate limits can only be made stricter.',
  })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatbotSettingsDto,
  ) {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.settings.updateChatbotSettings(chatbot, dto.settings);
  }

  // ── knowledge ─────────────────────────────────────────────────────────

  @Get(':id/documents')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  listDocuments(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatbots.listDocuments(id);
  }

  @Put(':id/documents')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Replace the library documents this bot answers from',
  })
  setDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetChatbotDocumentsDto,
  ) {
    return this.chatbots.setDocuments(id, dto.documentIds);
  }

  @Post(':id/documents/upload-url')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: "Presigned S3 PUT for a document of the bot's own (pdf/docx/epub)",
  })
  createDocumentUploadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateKbUploadUrlDto,
  ) {
    return this.chatbots.createDocumentUploadUrl(id, dto);
  }

  @Post(':id/documents/private')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: "Add a document of the bot's own",
    description:
      'Only this bot sees and answers from it; it is not listed in the knowledge library. ' +
      "Queued for indexing; returns the bot's documents.",
  })
  addOwnDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateKbOwnedDocumentDto,
  ) {
    return this.chatbots.addOwnDocument(id, dto);
  }

  @Delete(':id/documents/:documentId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Take a document off the bot',
    description:
      "The bot's own document is archived as well; a library document stays in the library.",
  })
  removeDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.chatbots.removeDocument(id, documentId);
  }

  // ── team ──────────────────────────────────────────────────────────────

  @Get(':id/members')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  listMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatbots.listMembers(id);
  }

  @Put(':id/members')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Replace who can see and manage this bot (owners)' })
  setMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetChatbotMembersDto,
  ) {
    return this.chatbots.setMembers(id, dto);
  }

  // ── who can chat ──────────────────────────────────────────────────────

  @Get(':id/audience')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  async listAudience(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id);
    return this.audience.list(id);
  }

  @Post(':id/audience')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Add people, organisations, phones or emails who may chat',
  })
  async addAudience(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddChatbotAudienceDto,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.audience.add(id, dto.entries);
  }

  @Delete(':id/audience/:entryId')
  @HttpCode(204)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  async removeAudience(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    await this.audience.remove(id, entryId);
  }

  // ── test ──────────────────────────────────────────────────────────────

  @Post(':id/test')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'Ask the bot a question without sending or storing anything',
    description:
      'Runs the same decision path as a real message. `draft` tries unsaved persona, model, document or settings changes.',
  })
  test(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TestChatbotDto) {
    return this.chatbots.test(id, dto);
  }
}
