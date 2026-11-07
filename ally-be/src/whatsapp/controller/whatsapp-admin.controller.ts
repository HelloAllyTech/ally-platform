import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { changesPlatformAdminOnlySetting } from '../../chatbot/service/chatbot-settings.service';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  CreateWaTemplateDto,
  PreviewAskDto,
  RegisterWaPhoneNumberDto,
  ReorderWaTemplatesDto,
  TestWaTemplateDto,
  UpdateWaSettingsDto,
  UpdateWaTemplateDto,
} from '../dto/whatsapp.dto';
import { WaTemplateKind } from '../enum/whatsapp.enum';
import { WhatsAppAdminService } from '../service/whatsapp-admin.service';

/**
 * Admin surface for the WhatsApp Q&A bot. SUPER_DUPER_ADMIN only
 * (migration 1892000000009).
 */
@ApiTags('WhatsApp Bot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/whatsapp')
export class WhatsAppAdminController {
  constructor(
    private readonly adminService: WhatsAppAdminService,
    private readonly access: ChatbotAccessService,
  ) {}

  /**
   * Replies for one bot (`?chatbotId=`) need membership of it — editor to change, any role to read;
   * the global defaults (no chatbotId) are platform admins' alone.
   */
  private async bot(
    chatbotId: string | undefined,
    change: boolean,
  ): Promise<string | undefined> {
    if (chatbotId) {
      await this.access.assert(
        chatbotId,
        change ? ChatbotMemberRole.EDITOR : ChatbotMemberRole.VIEWER,
      );
      return chatbotId;
    }
    await this.access.assertPlatformAdmin();
    return undefined;
  }

  // ── templates ─────────────────────────────────────────────────────────

  @Get('templates')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'List keyword templates in evaluation order',
    description:
      'Returned in the same (priority, createdAt) order the matcher uses, so the list IS the ' +
      'evaluation order rather than a separate view of it.',
  })
  async listTemplates(
    @Query('kind') kind?: WaTemplateKind,
    @Query('includeArchived') includeArchived?: string,
    @Query('chatbotId', new ParseUUIDPipe({ optional: true }))
    chatbotId?: string,
  ) {
    return this.adminService.listTemplates(
      kind,
      includeArchived === 'true',
      await this.bot(chatbotId, false),
    );
  }

  @Post('templates')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({ summary: 'Create a keyword template' })
  @ApiResponse({ status: 400, description: 'No patterns, or an invalid regex' })
  async createTemplate(
    @Body() dto: CreateWaTemplateDto,
    @Query('chatbotId', new ParseUUIDPipe({ optional: true }))
    chatbotId?: string,
  ) {
    return this.adminService.createTemplate(
      dto,
      await this.bot(chatbotId, true),
    );
  }

  @Post('templates/:id/customise')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: "An organisation's own version of a default reply",
    description:
      'Rewords, re-keys or (for an optional reply) switches off a default reply for one ' +
      'organisation. Creates the version the first time, edits it after. Required safety replies ' +
      'can be reworded but not switched off — 403.',
  })
  async customiseTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Body() dto: UpdateWaTemplateDto,
  ) {
    return this.adminService.customiseTemplate(
      id,
      (await this.bot(chatbotId, true))!,
      dto,
    );
  }

  @Patch('templates/:id')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'Update a template',
    description:
      "A mandatory template's wording is editable, but it cannot be deactivated — 403.",
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot deactivate a required safety template',
  })
  async updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWaTemplateDto,
    @Query('chatbotId', new ParseUUIDPipe({ optional: true }))
    chatbotId?: string,
  ) {
    return this.adminService.updateTemplate(
      id,
      dto,
      await this.bot(chatbotId, true),
    );
  }

  @Post('templates/:id/archive')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({ summary: 'Archive a template' })
  @ApiResponse({
    status: 403,
    description: 'Cannot remove a required safety template',
  })
  async archiveTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('chatbotId', new ParseUUIDPipe({ optional: true }))
    chatbotId?: string,
  ) {
    return this.adminService.archiveTemplate(
      id,
      await this.bot(chatbotId, true),
    );
  }

  @Post('templates/reorder')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'Rewrite priorities from an ordered id list',
    description:
      'Renumbers within each kind band, so a reorder can never move an FAQ rule ahead of a crisis ' +
      'rule.',
  })
  async reorderTemplates(
    @Body() dto: ReorderWaTemplatesDto,
    @Query('chatbotId', new ParseUUIDPipe({ optional: true }))
    chatbotId?: string,
  ) {
    return this.adminService.reorderTemplates(
      dto,
      await this.bot(chatbotId, true),
    );
  }

  @Post('templates/test')
  @CallerScopedRoute()
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT_TEMPLATES],
  })
  @ApiOperation({
    summary: 'Which rule would match this text — sends nothing',
    description:
      'Template ordering is safety-critical and otherwise invisible: an admin cannot tell that a ' +
      'new FAQ rule now swallows a phrase the crisis rule used to catch.',
  })
  async testTemplate(
    @Body() dto: TestWaTemplateDto,
    @Query('chatbotId', new ParseUUIDPipe({ optional: true }))
    chatbotId?: string,
  ) {
    return this.adminService.testTemplate(
      dto,
      await this.bot(chatbotId, false),
    );
  }

  // ── settings ──────────────────────────────────────────────────────────

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({ summary: 'The bot settings blob' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Put('settings')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Update settings',
    description:
      'Merged over what is stored, so a partial save cannot blank a field. Retrieval thresholds ' +
      'take effect on the next message — no deploy.',
  })
  async updateSettings(@Body() dto: UpdateWaSettingsDto) {
    const patch = dto as unknown as Record<string, unknown>;
    if (
      changesPlatformAdminOnlySetting(
        await this.adminService.getSettings(),
        patch,
      )
    ) {
      await this.access.assertPlatformAdmin();
    }
    return this.adminService.updateSettings(patch);
  }

  @Get('settings/provider-health')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Whether the provider is configured',
    description:
      'Booleans only, never the values — returning a secret to prove it is set would put it in the ' +
      'browser and in any screenshot of this screen.',
  })
  providerHealth() {
    return this.adminService.providerHealth();
  }

  @Post('settings/provider-check')
  @HttpCode(HttpStatus.OK)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Ask Meta, live, whether the token and number work',
    description:
      'Reads only. Returns the connected number, display name, quality rating and registration ' +
      'state, plus whether the app is subscribed to the business account webhooks — the things the ' +
      'configured-or-not booleans cannot show. A POST because it calls out to Meta on demand; it ' +
      'is not run on every page load.',
  })
  checkProviderConnection() {
    return this.adminService.checkProviderConnection();
  }

  @Post('settings/provider-register')
  @HttpCode(HttpStatus.OK)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Register the phone number for Cloud API use',
    description:
      'One-time Meta step before a number can send. Returns the refreshed connection check.',
  })
  registerPhoneNumber(@Body() dto: RegisterWaPhoneNumberDto) {
    return this.adminService.registerPhoneNumber(dto.pin);
  }

  @Post('settings/provider-subscribe')
  @HttpCode(HttpStatus.OK)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary: 'Subscribe the Meta app to the business account webhooks',
    description:
      'Idempotent. Without it Meta never delivers messages even though the webhook handshake ' +
      'succeeded. Returns the refreshed connection check.',
  })
  subscribeProviderApp() {
    return this.adminService.subscribeProviderApp();
  }

  // ── preview console ───────────────────────────────────────────────────

  @Post('preview/ask')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, {
    permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT],
  })
  @ApiOperation({
    summary:
      'Ask a question and see the exact reply — no send, no rows written',
    description:
      'Returns the composed message including source lines and truncation, plus the passages, ' +
      'scores, model and latency. Writes nothing, so an admin experimenting cannot pollute the ' +
      'conversation log or the unanswered queue.',
  })
  previewAsk(@Body() dto: PreviewAskDto) {
    return this.adminService.previewAsk(dto);
  }
}
