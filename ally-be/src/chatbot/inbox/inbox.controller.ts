import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { SseWriter } from '../../common/sse/sse-writer';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ConversationChannel } from '../enum/conversation.enum';
import { HandoverService } from '../handover/handover.service';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { InboxEventsService } from './inbox-events.service';
import {
  InboxService,
  type InboxChannelFilter,
  type InboxView,
} from './inbox.service';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
/** How often a live inbox stream re-reads which assistants its user can see. */
const RESCOPE_MS = 5 * 60_000;

export class InboxQueryDto {
  @ApiPropertyOptional({ enum: ['needs_person', 'live', 'all'] })
  @IsOptional()
  @IsIn(['needs_person', 'live', 'all'])
  view?: InboxView;

  @ApiPropertyOptional({
    enum: [...Object.values(ConversationChannel), 'widget'],
    description: '`widget`: web chats from the website widget; `web`: the rest',
  })
  @IsOptional()
  @IsIn([...Object.values(ConversationChannel), 'widget'])
  channel?: InboxChannelFilter;

  @ApiPropertyOptional() @IsOptional() @IsUUID() chatbotId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;
}

export class InboxReplyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) text!: string;
}

const userId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/**
 * The inbox (chunk 11a): every channel's chats in one place, live; taking a chat over, replying on
 * its channel and handing it back. Viewers read; editors take over and reply.
 */
@ApiTags('Inbox')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/inbox')
@CallerScopedRoute()
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly handover: HandoverService,
    private readonly events: InboxEventsService,
    private readonly access: ChatbotAccessService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get('conversations')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'Chats from every channel: Safety and Needs a person first',
  })
  list(@Query() query: InboxQueryDto) {
    return this.inbox.list(query);
  }

  @Get('counts')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'Unread chats, Needs a person and Safety, for the nav',
  })
  counts() {
    return this.inbox.counts();
  }

  @Get('events')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'Live inbox events (SSE)',
    description:
      'Starts with `hello` (the counts), so a reconnect redraws from it; then `message`, `state`, `safety` and `read`, each with ids only, never message text. A comment line every 10 s.',
  })
  async stream(@Res() res: Response): Promise<void> {
    const sse = new SseWriter(res);
    sse.send('hello', await this.inbox.counts());
    const forward = (event: { type: string }) => {
      const { type, ...data } = event;
      sse.send(type, data);
    };
    const subscribe = async () => {
      const ids = await this.inbox.scope();
      // A platform admin sees every assistant: listen to all that have chats.
      const chatbots =
        ids ??
        (
          (await this.dataSource.query(
            `SELECT id FROM chatbots WHERE archived_at IS NULL`,
          )) as { id: string }[]
        ).map((r) => r.id);
      return this.events.listenInbox(chatbots, forward);
    };
    let stop = await subscribe();
    // Someone removed from an assistant stops hearing about it within RESCOPE_MS.
    const rescope = setInterval(() => {
      void subscribe().then((next) => {
        stop();
        stop = next;
      });
    }, RESCOPE_MS);
    await new Promise<void>((resolve) =>
      sse.closed.signal.addEventListener('abort', () => resolve()),
    );
    clearInterval(rescope);
    stop();
    sse.end();
  }

  @Get('chatbots/:chatbotId/conversations/:id')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({ summary: 'One chat, marked read for you' })
  async thread(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const thread = await this.inbox.thread(chatbotId, id);
    if (!thread)
      throw new NotFoundException('That conversation was not found.');
    await this.inbox.markRead(chatbotId, id);
    await this.events.publishInbox({
      type: 'read',
      chatbotId,
      conversationId: id,
    });
    return thread;
  }

  @Post('chatbots/:chatbotId/conversations/:id/take-over')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Take the chat over: the assistant pauses in this chat only (first one wins)',
  })
  async takeOver(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    return this.handover.takeOver(chatbotId, id, userId());
  }

  @Post('chatbots/:chatbotId/conversations/:id/hand-back')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Hand the chat back to the assistant (the person replying, or an owner)',
  })
  async handBack(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { role } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    return this.handover.handBack(
      chatbotId,
      id,
      userId(),
      role === ChatbotMemberRole.OWNER,
    );
  }

  @Post('chatbots/:chatbotId/conversations/:id/messages')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      "Reply on the chat's channel (WhatsApp only within 24 hours of their last message)",
  })
  async reply(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InboxReplyDto,
  ) {
    const { chatbot } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    const [user] = (await this.dataSource.query(
      `SELECT id, name FROM users WHERE id = $1`,
      [userId()],
    )) as { id: number; name: string | null }[];
    return this.handover.reply(
      chatbot,
      id,
      user ?? { id: userId(), name: null },
      dto.text,
    );
  }
}
