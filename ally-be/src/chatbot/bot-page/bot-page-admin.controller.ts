import {
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
  Query,
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
  ) {}

  @Get(':id/page')
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
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Save the bot page',
    description:
      'Public access needs the platform to allow it (botPagePublicAllowed). Links are unique.',
  })
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBotPageDto,
  ) {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.pages.save(chatbot, dto);
  }

  @Get(':id/page/slug-available')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'Whether a link is valid and free for this bot' })
  async slugAvailable(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('slug') slug: string,
  ) {
    await this.access.assert(id);
    try {
      const checked = BotPageService.checkSlug(slug);
      return {
        slug: checked,
        available: await this.pages.slugAvailable(checked, id),
      };
    } catch (error) {
      return {
        slug,
        available: false,
        reason: (error as Error).message,
      };
    }
  }

  @Post(':id/page/logo-url')
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
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'Invited emails and allowed organisations' })
  async listAccess(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id);
    const page = await this.pages.findForChatbot(id);
    return { entries: page ? await this.pageAccess.list(page.id) : [] };
  }

  @Post(':id/page/access')
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
