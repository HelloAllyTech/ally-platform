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
import { StaffOnly } from '../../auth/decorators/staff-only.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AssistantScope } from '../access/chatbot-role.decorator';
import {
  DryRunDto,
  PushQuickReplyDto,
  SafetyTranslationDto,
  SetCuratedDto,
} from '../dto/customer-data.dto';
import { SafetyTranslationsService } from '../languages/safety-translations.service';
import { AssistantRetentionService } from '../privacy/assistant-retention.service';
import { MemoryConsentService } from '../privacy/memory-consent.service';
import { QuickReplyCopyService } from '../quick-replies/quick-reply-copy.service';
import { ChatbotSharingService } from './chatbot-sharing.service';

/**
 * Ally staff only (404 to everyone else): the quick-reply push, the curated pool, reviewed
 * safety translations, and the stage 5 cutover reports (retention dry run, memory cutover).
 */
@ApiTags('Staff')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/staff')
export class StaffAssistantsController {
  constructor(
    private readonly quickReplies: QuickReplyCopyService,
    private readonly sharing: ChatbotSharingService,
    private readonly translations: SafetyTranslationsService,
    private readonly retention: AssistantRetentionService,
    private readonly consent: MemoryConsentService,
  ) {}

  @Post('quick-replies/push')
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      "Change a fixed reply's wording and push it to every chatbot's locked copy; owners are told by email",
  })
  push(@Body() dto: PushQuickReplyDto) {
    return this.quickReplies.pushLocked(
      dto.globalId,
      {
        responseText: dto.responseText,
        patterns: dto.patterns,
        name: dto.name,
      },
      Number(ExecutionManager.getUserId() ?? 0) || null,
    );
  }

  @Put('knowledge/:documentId/curated')
  @HttpCode(204)
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary: 'Put a library document in the curated pool, or take it out',
  })
  async setCurated(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: SetCuratedDto,
  ) {
    await this.sharing.setCurated(documentId, dto.curated);
  }

  @Put('safety-translations')
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      'Store a platform-wide translation of a safety text (unreviewed until marked)',
  })
  saveTranslation(@Body() dto: SafetyTranslationDto) {
    return this.translations.upsert({ chatbotId: null, ...dto });
  }

  @Post('safety-translations/:translationId/review')
  @HttpCode(204)
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      'Mark a translation reviewed: from now on it is used for crisis replies in its language',
  })
  async review(@Param('translationId', ParseUUIDPipe) translationId: string) {
    await this.translations.markReviewed(
      translationId,
      Number(ExecutionManager.getUserId() ?? 0) || null,
    );
  }

  @Get('retention/report')
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      'The retention sweep as a dry run: counts per store, and why a real run is blocked',
  })
  retentionReport() {
    return this.retention.run({ dryRun: true });
  }

  @Post('memory-cutover')
  @StaffOnly()
  @AssistantScope('platform')
  @ApiOperation({
    summary:
      'D7: delete memory stored before consent. Dry run unless dryRun=false; behind ASSISTANT_MEMORY_CUTOVER_ENABLED',
  })
  memoryCutover(@Body() dto: DryRunDto) {
    return this.consent.cutover({ dryRun: dto.dryRun !== false });
  }
}
