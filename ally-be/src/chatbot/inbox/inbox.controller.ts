import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ChatbotCapability, ChatbotMemberRole } from '../enum/chatbot.enum';
import { ConversationChannel } from '../enum/conversation.enum';
import { HandoverService } from '../handover/handover.service';
import { MemoryService } from '../memory/memory.service';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { InboxEventsService } from './inbox-events.service';
import {
  InboxService,
  type InboxChannelFilter,
  type InboxView,
} from './inbox.service';
import {
  ChatbotCan,
  ChatbotRole,
  AssistantScope,
} from '../access/chatbot-role.decorator';
import { ResponderAgreementService } from '../members/responder-agreement.service';

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

/** Stage 8: Ally staff name the one chatbot they are reading (with the owner's grant). */
export class InboxCountsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() chatbotId?: string;
}

export class MemoryQueryDto {
  /** The chat open beside it: its pre-chat answers and summary come too. */
  @ApiPropertyOptional() @IsOptional() @IsUUID() conversationId?: string;
}

export class MemoryLineDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) text!: string;
}

/** Why an edited line was refused, as the owner reads it (copy deck §28). */
export const MEMORY_NEVER_STORE_MESSAGE =
  "That's on the list of things your assistant never remembers.";
export const MEMORY_INVALID_MESSAGE = 'Write it in 1 to 200 characters.';

export class InboxReplyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) text!: string;
}

const userId = (): number => Number(ExecutionManager.getUserId() ?? 0);

/**
 * The inbox (chunk 11a): every channel's chats in one place, live; taking a chat over, replying on
 * its channel and handing it back. Viewers read; responders, editors and owners take over and reply
 * (Stage 1b: the `respond` capability, after accepting the responder agreement).
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
    @Optional() private readonly memory?: MemoryService,
    @Optional() private readonly agreement?: ResponderAgreementService,
  ) {}

  /** Who holds the chat now (null: the assistant), for the responder-agreement checks. */
  private async heldBy(
    chatbotId: string,
    conversationId: string,
  ): Promise<number | null> {
    const [row] = (await this.dataSource.query(
      `SELECT handled_by_user_id FROM chatbot_conversations WHERE id = $1 AND chatbot_id = $2`,
      [conversationId, chatbotId],
    )) as { handled_by_user_id: number | null }[];
    return row?.handled_by_user_id ?? null;
  }

  // ──────────────────────────────── what the assistant remembers (chunk 8a)

  private memoryService(): MemoryService {
    if (!this.memory) throw new NotFoundException();
    return this.memory;
  }

  /** The bot and a contact of it, for the caller's role; 404 for anyone else's contact. */
  private async personOf(
    chatbotId: string,
    contactId: string,
    role: ChatbotMemberRole,
  ) {
    const { chatbot } = await this.access.assert(chatbotId, role);
    if (!(await this.memoryService().contactOf(chatbotId, contactId))) {
      throw new NotFoundException();
    }
    return chatbot;
  }

  @Get('chatbots/:chatbotId/contacts/:contactId/memory')
  @ChatbotRole(ChatbotMemberRole.VIEWER, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary:
      'What the assistant remembers about one person, with each line’s source',
    description:
      '`on` is false when the assistant doesn’t remember people between chats. Lines are active ones, newest first; `sourceMessageId` and `sourceConversationId` point at the message each came from (null once it’s gone); `expiresAt` null means kept until forgotten. With `conversationId`, that chat’s pre-chat answers the assistant reads (`beforeChat`, never phone or email) and its rolling summary come too. `neverStore` is what it never keeps.',
  })
  async memoryOf(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query() query: MemoryQueryDto,
  ) {
    const chatbot = await this.personOf(
      chatbotId,
      contactId,
      ChatbotMemberRole.VIEWER,
    );
    return this.memoryService().forInbox(
      chatbot,
      contactId,
      query.conversationId,
    );
  }

  @Post('chatbots/:chatbotId/memory/:entryId/forget')
  @ChatbotRole(ChatbotMemberRole.EDITOR, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Forget one line: deleted now' })
  async forgetLine(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    if (!(await this.memoryService().forget(chatbotId, entryId))) {
      throw new NotFoundException();
    }
    return { forgotten: true };
  }

  @Patch('chatbots/:chatbotId/memory/:entryId')
  @ChatbotRole(ChatbotMemberRole.EDITOR, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Change a line’s text; it becomes yours (source: owner)',
  })
  async editLine(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: MemoryLineDto,
  ) {
    const { chatbot } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    const result = await this.memoryService().edit(chatbot, entryId, dto.text);
    if (result.ok) return result.line;
    if (result.reason === 'not_found') throw new NotFoundException();
    throw new BadRequestException({
      code: result.reason,
      message:
        result.reason === 'never_store'
          ? MEMORY_NEVER_STORE_MESSAGE
          : MEMORY_INVALID_MESSAGE,
    });
  }

  @Post('chatbots/:chatbotId/contacts/:contactId/forget')
  @ChatbotRole(ChatbotMemberRole.EDITOR, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Forget this person: every line about them and their chats’ summaries. Messages stay.',
  })
  async forgetPerson(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    await this.personOf(chatbotId, contactId, ChatbotMemberRole.EDITOR);
    const lines = await this.memoryService().forgetPerson(chatbotId, contactId);
    return { forgotten: lines };
  }

  @Get('conversations')
  @AssistantScope('list')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'Chats from every channel: Safety and Needs a person first',
  })
  async list(@Query() query: InboxQueryDto) {
    // Stage 8: Ally staff name one chatbot; read only with the owner's live grant, logged first.
    const staffScope = await this.access.staffListScope(query.chatbotId, {
      key: 'InboxController.list',
      route: 'GET /v1/inbox/conversations',
    });
    return this.inbox.list(query, staffScope);
  }

  @Get('counts')
  @AssistantScope('list')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'Unread chats, Needs a person and Safety, for the nav',
  })
  async counts(@Query() query: InboxCountsQueryDto) {
    const staffScope = await this.access.staffListScope(query.chatbotId, {
      key: 'InboxController.counts',
      route: 'GET /v1/inbox/counts',
    });
    return this.inbox.counts(staffScope, query.chatbotId);
  }

  @Get('events')
  @AssistantScope('list')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({
    summary: 'Live inbox events (SSE)',
    description:
      'Starts with `hello` (the counts), so a reconnect redraws from it; then `message`, `state`, `safety` and `read`, each with ids only, never message text. A comment line every 10 s.',
  })
  async stream(@Res() res: Response): Promise<void> {
    const sse = new SseWriter(res);
    sse.send('hello', await this.inbox.counts());
    let rescopeNow: () => void = () => undefined;
    const forward = (event: { type: string; removedUserIds?: unknown }) => {
      if (event.type === 'members') {
        // Stage 1b: someone taken off a team stops hearing about it at once.
        const removed = Array.isArray(event.removedUserIds)
          ? event.removedUserIds.map(Number)
          : [];
        if (removed.includes(userId())) rescopeNow();
        return;
      }
      const { type, ...data } = event;
      sse.send(type, data);
    };
    const subscribe = async () => {
      // Only the assistants the caller is a member of (platform admins included, A1).
      const chatbots = await this.inbox.scope();
      return this.events.listenInbox(chatbots, forward);
    };
    let stop = await subscribe();
    rescopeNow = () => {
      void subscribe().then((next) => {
        stop();
        stop = next;
      });
    };
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
  @ChatbotRole(ChatbotMemberRole.VIEWER, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT)
  @ApiOperation({ summary: 'One chat, marked read for you' })
  async thread(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Stage 1b: a responder-only member reads a chat only under the current agreement, or one
    // they already hold.
    const { roles } = await this.access.assertCan(
      chatbotId,
      ChatbotCapability.VIEW,
    );
    await this.agreement?.assertMayRead(
      userId(),
      roles,
      await this.heldBy(chatbotId, id),
    );
    const thread = await this.inbox.thread(chatbotId, id);
    if (!thread)
      throw new NotFoundException('That conversation was not found.');
    // Stage 8: an Ally staff view never marks a chat read (it would hide it from the owners'
    // "nobody opened it" email).
    if (!this.access.isStaffView(chatbotId)) {
      await this.inbox.markRead(chatbotId, id);
      await this.events.publishInbox({
        type: 'read',
        chatbotId,
        conversationId: id,
      });
    }
    return thread;
  }

  @Post('chatbots/:chatbotId/conversations/:id/take-over')
  @ChatbotCan(ChatbotCapability.RESPOND, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Take the chat over: the assistant pauses in this chat only (first one wins)',
  })
  async takeOver(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.assertCan(chatbotId, ChatbotCapability.RESPOND);
    // A new agreement version blocks new take-overs only, never a chat already held.
    await this.agreement?.assertMayTakeOver(
      userId(),
      await this.heldBy(chatbotId, id),
    );
    return this.handover.takeOver(chatbotId, id, userId());
  }

  @Post('chatbots/:chatbotId/conversations/:id/hand-back')
  @ChatbotCan(ChatbotCapability.RESPOND, 'chatbotId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Hand the chat back to the assistant (the person replying, or an owner)',
  })
  async handBack(
    @Param('chatbotId', ParseUUIDPipe) chatbotId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { roles } = await this.access.assertCan(
      chatbotId,
      ChatbotCapability.RESPOND,
    );
    return this.handover.handBack(
      chatbotId,
      id,
      userId(),
      roles.includes(ChatbotMemberRole.OWNER),
    );
  }

  @Post('chatbots/:chatbotId/conversations/:id/messages')
  @ChatbotCan(ChatbotCapability.RESPOND, 'chatbotId')
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
    const { chatbot } = await this.access.assertCan(
      chatbotId,
      ChatbotCapability.RESPOND,
    );
    await this.agreement?.assertMayReply(
      userId(),
      await this.heldBy(chatbotId, id),
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
