import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
  AddBotPageAccessDto,
  BotPageLogoUrlDto,
  UpdateBotPageDto,
} from '../dto/bot-page.dto';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { BotPageAccessService } from './bot-page-access.service';
import { BotPageRateLimitService } from './bot-page-rate-limit.service';
import { BotPageService } from './bot-page.service';
import { WidgetSitesService } from './widget-sites.service';
import { ChatbotRole } from '../access/chatbot-role.decorator';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * The Bot page tab: a bot's shareable chat link, its branding, who may open it, and its limits.
 * Any member can read it; editors change it.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class BotPageAdminController {
  constructor(
    private readonly access: ChatbotAccessService,
    private readonly pages: BotPageService,
    private readonly pageAccess: BotPageAccessService,
    private readonly limits: BotPageRateLimitService,
    private readonly sites: WidgetSitesService,
  ) {}

  @Get(':id/page')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'The bot page, or its defaults before the first save',
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const { chatbot } = await this.access.assert(id);
    const view = await this.pages.view(chatbot);
    return {
      ...view,
      dailyCapReached: await this.limits.dailyCapReached(
        chatbot.id,
        view.settings.limits.dailyCapPerBot,
      ),
    };
  }

  @Put(':id/page')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Save the bot page',
    description:
      'Public access needs the platform to allow it (botPagePublicAllowed). Stage 7: the address is assigned by Ally; a `slug` other than the stored one is refused (400 address_not_editable), and so are the retired look fields (subtitle, avatarUrl, disclaimer, footerLink: 400 look_field_retired).',
  })
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBotPageDto,
  ) {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.EDITOR);
    const existing = await this.pages.findForChatbot(chatbot.id);
    rejectRetiredPageFields(dto, existing?.slug ?? null);
    return this.pages.save(chatbot, dto);
  }

  // Stage 7: `GET :id/page/slug-available` is gone. The address is Ally's and can't be edited.

  @Get(':id/widget-sites')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'Sites the website widget has loaded on (stage 7)',
    description:
      'Most recent first, at most 200. Recorded at most once an hour per site, so counts are approximate.',
  })
  async widgetSites(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assertOrStaffView(id, ChatbotMemberRole.EDITOR);
    return { sites: await this.sites.list(id) };
  }

  @Post(':id/page/logo-url')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'An upload link for the page logo (PNG, JPEG or WebP, 2 MB)',
  })
  async logoUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BotPageLogoUrlDto,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.pages.logoUploadUrl(id, dto);
  }

  // ── who may open it ───────────────────────────────────────────────────

  @Get(':id/page/access')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'Invited emails and allowed organisations' })
  async listAccess(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id);
    const page = await this.pages.findForChatbot(id);
    return { entries: page ? await this.pageAccess.list(page.id) : [] };
  }

  @Post(':id/page/access')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Add invited emails or organisations; existing ones are skipped',
  })
  async addAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddBotPageAccessDto,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    const page = await this.requirePage(id);
    return this.pageAccess.add(page.id, dto.entries);
  }

  @Delete(':id/page/access/:entryId')
  @HttpCode(204)
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  async removeAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    const page = await this.requirePage(id);
    await this.pageAccess.remove(page.id, entryId);
  }

  private async requirePage(chatbotId: string) {
    const page = await this.pages.findForChatbot(chatbotId);
    if (!page) {
      throw new NotFoundException('Save the bot page first, then add people.');
    }
    return page;
  }
}

const RETIRED_BRANDING = [
  'subtitle',
  'avatarUrl',
  'disclaimer',
  'footerLink',
] as const;

/**
 * Stage 7, at the HTTP edge only (onboarding's publish calls `save` directly and its extra fields
 * are ignored there): the owner can't set the address, and the retired look words are refused.
 */
export function rejectRetiredPageFields(
  dto: UpdateBotPageDto,
  storedSlug: string | null,
): void {
  if (
    dto.slug !== undefined &&
    dto.slug !== null &&
    dto.slug.trim().toLowerCase() !== (storedSlug ?? '').toLowerCase()
  ) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'address_not_editable',
      message: "The page's address is assigned by Ally and can't be changed.",
    });
  }
  const branding = (dto.settings?.branding ?? {}) as unknown as Record<
    string,
    unknown
  >;
  const sent = RETIRED_BRANDING.filter((key) => key in branding);
  const brand = (dto.settings as unknown as { brand?: object } | undefined)
    ?.brand;
  if (sent.length) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'look_field_retired',
      message: `These can no longer be changed: ${sent.join(', ')}. The page shows its name, logo, one colour and a welcome line.`,
      fields: sent,
    });
  }
  if (brand) BotPageService.rejectRetiredLook(brand);
}
