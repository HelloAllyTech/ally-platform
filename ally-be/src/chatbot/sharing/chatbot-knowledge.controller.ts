import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { KnowledgeReviewService } from '../../knowledge-base/privacy/knowledge-review.service';
import { AssistantScope, ChatbotRole } from '../access/chatbot-role.decorator';
import {
  AddFromPoolDto,
  CopyKnowledgeDto,
  SafetyTranslationDto,
} from '../dto/customer-data.dto';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { KnowledgeFreshnessService } from '../knowledge/knowledge-freshness.service';
import { SafetyTranslationsService } from '../languages/safety-translations.service';
import { ChatbotSharingService } from './chatbot-sharing.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * Assistants stage 5 on one chatbot: personal-data review of its sources, "Read again", copy
 * (duplicate, copy knowledge, add from the curated pool) and its safety-text translations.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class ChatbotKnowledgeController {
  constructor(
    private readonly review: KnowledgeReviewService,
    private readonly freshness: KnowledgeFreshnessService,
    private readonly sharing: ChatbotSharingService,
    private readonly translations: SafetyTranslationsService,
  ) {}

  @Get(':id/knowledge/review')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      'Sources held because they may contain personal details, with what was found (masked)',
  })
  async listReview(@Param('id', ParseUUIDPipe) id: string) {
    return { documents: await this.review.listForReview(id) };
  }

  @Post(':id/knowledge/:documentId/approve')
  @HttpCode(204)
  @ChatbotRole(ChatbotMemberRole.OWNER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Owner approves a held source: it is indexed from its stored text. 409 when it is not waiting for review.',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.review.approve(id, documentId);
  }

  @Post(':id/knowledge/:documentId/exclude')
  @HttpCode(204)
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Exclude a held source: archived, never indexed, its text dropped',
  })
  async exclude(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.review.exclude(id, documentId);
  }

  @Post(':id/knowledge/sources/:documentId/read-again')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Read a source again: a web page is fetched and re-indexed only when its text changed; a file is marked as confirmed',
  })
  readAgain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.freshness.readAgain(id, documentId);
  }

  @Get(':id/knowledge/freshness')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      'Days since the oldest source was read, and whether the 30-day nudge shows',
  })
  freshnessOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.freshness.staleness(id);
  }

  @Post(':id/knowledge/copy-from/:otherId')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Copy documents from another chatbot you can edit: private copies, indexed in the background and charged to you',
  })
  copyFrom(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
    @Body() dto: CopyKnowledgeDto,
  ) {
    return this.sharing.copyKnowledgeFrom(id, otherId, dto.documentIds);
  }

  @Post(':id/knowledge/add-from-pool')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      "Copy a document from Ally's curated pool into this chatbot (a private copy, re-indexed)",
  })
  addFromPool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddFromPoolDto,
  ) {
    return this.sharing.addFromPool(id, dto.documentId);
  }

  @Post(':id/duplicate')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Duplicate a chatbot: persona, settings, rules, quick replies, list definitions and documents (copied). Never channels, members, access list, memory, contacts or conversations. The copy is a draft you own.',
  })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.duplicate(id);
  }

  @Get(':id/safety-translations')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      "This chatbot's translations of the fixed safety texts, with their review state",
  })
  async listTranslations(@Param('id', ParseUUIDPipe) id: string) {
    return { translations: await this.translations.list(id) };
  }

  @Put(':id/safety-translations')
  @ChatbotRole(ChatbotMemberRole.OWNER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Store a translation of a safety text for a language. It is not used for crisis replies until Ally marks it reviewed.',
  })
  saveTranslation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SafetyTranslationDto,
  ) {
    return this.translations.upsert({ chatbotId: id, ...dto });
  }
}

/** Ally's curated knowledge pool, for any builder to copy from. */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/knowledge')
@CallerScopedRoute()
export class KnowledgePoolController {
  constructor(private readonly sharing: ChatbotSharingService) {}

  @Get('curated')
  @AssistantScope('list')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: "Documents in Ally's curated pool (copied on choice)",
  })
  async curated() {
    return { documents: await this.sharing.listCurated() };
  }
}
