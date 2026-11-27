import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { SseWriter } from 'src/common/sse/sse-writer';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import {
  DismissManualDraftDto,
  ManualChatStreamDto,
  SaveManualDraftDto,
} from '../dto/manual-chat.dto';
import { ManualChatService } from '../service/manual-chat.service';
import {
  ConversationRow,
  ConversationView,
  ManualConversationService,
} from '../service/manual-conversation.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

/**
 * The Product Manual's chat (docs/product-manual.md → Chat): the caller's own conversations, one
 * streamed turn at a time, and the drafts tray. Same gate as the reader: the Product Manual toggle,
 * 404 while Roadmap v2 is off, 403 for a caller with no roadmap role.
 */
@ApiTags('Product Manual')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-manual', version: '1' })
export class ManualChatController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly conversations: ManualConversationService,
    private readonly chat: ManualChatService,
  ) {}

  private async gate(userId: number): Promise<void> {
    await this.settings.assertRoadmapV2();
    const role = await this.roles.roleOf(userId);
    if (role === 'none') {
      throw new ForbiddenException('You do not have access to the Roadmap.');
    }
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('conversations')
  @ApiOperation({ summary: 'Your chats with the manual, newest first' })
  async list(
    @CurrentUser() user: TokenUser,
  ): Promise<{ conversations: ConversationRow[] }> {
    await this.gate(user.id);
    return { conversations: await this.conversations.list(user.id) };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Get('conversations/:id')
  @ApiOperation({ summary: 'One of your chats: messages and drafts tray' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<ConversationView> {
    await this.gate(user.id);
    return this.conversations.view(user.id, id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of your chats' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<void> {
    await this.gate(user.id);
    await this.conversations.remove(user.id, id);
  }

  /**
   * One turn as Server-Sent Events: meta, then activity / token / citation / draft / page_edited,
   * then done or error. A refusal (404 conversation, 409 busy) is a plain HTTP error: it happens
   * before the first event.
   */
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Post('chat/stream')
  @ApiOperation({ summary: 'Ask the manual (SSE)' })
  async stream(
    @Body() dto: ManualChatStreamDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.gate(user.id);
    const turn = await this.chat.prepare(user.id, {
      conversationId: dto.conversationId,
      message: dto.message,
      context: dto.context,
    });
    const sse = new SseWriter(res);
    try {
      await this.chat.run(
        turn,
        (event, data) => sse.send(event, data),
        sse.closed.signal,
      );
    } finally {
      await this.chat.release(turn);
      sse.end();
    }
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Post('drafts')
  @ApiOperation({ summary: 'Save a tray card as a roadmap draft' })
  async saveDraft(
    @Body() dto: SaveManualDraftDto,
    @CurrentUser() user: TokenUser,
  ): Promise<{ code: string }> {
    await this.gate(user.id);
    return this.chat.saveDraft(user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, VIEW)
  @Post('drafts/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a card from the tray' })
  async dismissDraft(
    @Body() dto: DismissManualDraftDto,
    @CurrentUser() user: TokenUser,
  ): Promise<void> {
    await this.gate(user.id);
    await this.chat.dismissDraft(user.id, dto.conversationId, dto.draftId);
  }
}
