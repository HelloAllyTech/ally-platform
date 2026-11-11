import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { BotPageService } from '../bot-page/bot-page.service';
import {
  UpdateBotImageDto,
  UpdateBotPageBrandDto,
  UploadBotImageDto,
} from '../dto/bot-image.dto';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { BotImageService, IMAGE_ERRORS } from './bot-image.service';
import { IMAGE_MAX_BYTES } from './image-check';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * A bot's images and its page's look (chunk 20d): upload, alt text, remove and undo, and the
 * brand. Members read; editors change.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class BotImageController {
  constructor(
    private readonly access: ChatbotAccessService,
    private readonly images: BotImageService,
    private readonly pages: BotPageService,
  ) {}

  @Get(':id/images')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: "The bot's images, with short-lived signed URLs" })
  async list(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assert(id);
    return this.images.list(id);
  }

  @Post(':id/images')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an image (PNG, JPEG or WebP; SVG for logos), up to 5 MB',
    description:
      'Checked by its bytes, re-encoded without metadata, and stored at 256, 768 and 1600 px.',
  })
  // One byte over the limit is enough to know it is too large; multer stops reading there.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMAGE_MAX_BYTES + 1, files: 1 },
    }),
  )
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadBotImageDto,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    if (!file) throw new BadRequestException(IMAGE_ERRORS.failed);
    return this.images.upload(id, file, dto.kind, dto.alt ?? '');
  }

  @Patch(':id/images/:imageId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: "Change an image's alt text" })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: UpdateBotImageDto,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.images.setAlt(id, imageId, dto.alt);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(204)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Remove an image',
    description:
      'Unreadable at once; its files are deleted after 30 days, so it can be restored.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    await this.images.detach(id, imageId);
  }

  @Post(':id/images/:imageId/restore')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Undo removing an image (within 30 days)' })
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.images.restore(id, imageId);
  }

  @Patch(':id/page/brand')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      "Change the page's look: logo, colour, heading style, theme and images",
    description:
      'Only the fields sent change. Creates the page (off) if it was never saved.',
  })
  async brand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBotPageBrandDto,
  ) {
    const { chatbot } = await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.pages.saveBrand(chatbot, dto);
  }
}
