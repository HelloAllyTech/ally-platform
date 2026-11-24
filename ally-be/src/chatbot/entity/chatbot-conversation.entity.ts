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

  /**
   * The single switch (chunk 11a): the team member handling this chat, or null when the assistant
   * is. While it is set the engine never answers here; a crisis message still gets the crisis reply.
   */
  @Column({ name: 'handled_by_user_id', type: 'int', nullable: true })
  handledByUserId?: number | null;

  @Column({ name: 'handled_since', type: 'timestamp', nullable: true })
  handledSince?: Date | null;

  /** When the chat started needing a person, and why ("asked", "declined_twice" or "assistant"). */
  @Column({ name: 'needs_person_since', type: 'timestamp', nullable: true })
  needsPersonSince?: Date | null;

  @Column({
    name: 'needs_person_reason',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  needsPersonReason?: string | null;

  /** The last crisis reply here: the inbox lists it as Safety, at the top. */
  @Column({ name: 'safety_at', type: 'timestamp', nullable: true })
  safetyAt?: Date | null;

  /** The FIRST crisis flag on this chat, set once and never overwritten (D14). */
  @Column({ name: 'safety_first_at', type: 'timestamp', nullable: true })
  safetyFirstAt?: Date | null;

  /** Highest crisis level seen: 1 at risk, 2 medical emergency. */
  @Column({ name: 'safety_level', type: 'smallint', nullable: true })
  safetyLevel?: number | null;

  /** When a person first took over a flagged chat; null while the flag is untaken. */
  @Column({ name: 'safety_taken_at', type: 'timestamp', nullable: true })
  safetyTakenAt?: Date | null;

  /** The retention sweep keeps a flagged chat until this: first flag + 12 months. */
  @Column({ name: 'retain_until', type: 'timestamp', nullable: true })
  retainUntil?: Date | null;

  @Column({ name: 'last_human_reply_at', type: 'timestamp', nullable: true })
  lastHumanReplyAt?: Date | null;

  /** A summary of the thread (chunk 16). */
  @Column({ type: 'text', nullable: true })
  summary?: string | null;
}
