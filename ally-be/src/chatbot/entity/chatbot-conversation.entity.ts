import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  ConversationChannel,
  ConversationStatus,
} from '../enum/conversation.enum';

/**
 * A thread of messages between one contact and one bot, on one channel.
 *
 * A thread stays open while messages keep arriving within the bot's idle window
 * (`conversationIdleMinutes`), and belongs to the bot that started it — the same rules as
 * `wa_conversations`. Copied from WhatsApp, the id is the `wa_conversations.id`, which is also the
 * LangGraph thread id, so checkpoints stay attached.
 */
@Entity('chatbot_conversations')
@Index('idx_chatbot_conversations_chatbot', ['chatbotId', 'lastMessageAt'])
@Index('idx_chatbot_conversations_open', [
  'contactId',
  'chatbotId',
  'channel',
  'lastMessageAt',
])
export class ChatbotConversation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'uuid', name: 'contact_id' })
  contactId!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: ConversationChannel;

  /** The connector it came in through. Null on WhatsApp's platform number. */
  @Column({ type: 'uuid', name: 'connector_id', nullable: true })
  connectorId?: string | null;

  /** `closed` only when a bot page visitor starts a new chat (12b); WhatsApp threads stay open. */
  @Column({ type: 'varchar', length: 16, default: ConversationStatus.OPEN })
  status!: ConversationStatus;

  @Column({ type: 'timestamp', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamp', name: 'last_message_at' })
  lastMessageAt!: Date;

  /** Channel extras, such as the bot page's pre-chat answers (chunk 12b). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  /** A summary of the thread (chunk 16). */
  @Column({ type: 'text', nullable: true })
  summary?: string | null;
}
