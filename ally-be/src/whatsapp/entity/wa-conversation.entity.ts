import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A thread of messages with one contact.
 *
 * WhatsApp has no session or conversation concept of its own — it is an endless per-number message
 * stream — so one is defined here: `conversationIdleMinutes` of silence (default 1440) closes the
 * thread and the next message opens a new one.
 *
 * Two things need it. The admin log needs a unit to display, and the RAG agent needs a short
 * history so "what about for children?" resolves against the previous question rather than being
 * retrieved on its own. An unbounded stream would mean feeding the model a month-old exchange as
 * context for today's question, which is worse than no context at all.
 */
@Entity('wa_conversations')
export class WaConversation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_wa_conversations_contact')
  @Column({ type: 'uuid', name: 'contact_id' })
  contactId!: string;

  @Column({ type: 'timestamp', name: 'started_at' })
  startedAt!: Date;

  /** Drives the idle cutoff, and the default ordering of the admin log. */
  @Index('idx_wa_conversations_last_message')
  @Column({ type: 'timestamp', name: 'last_message_at' })
  lastMessageAt!: Date;

  @Column({ type: 'int', name: 'message_count', default: 0 })
  messageCount!: number;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'last_language',
    nullable: true,
  })
  lastLanguage?: string | null;

  /**
   * The bot that answered this thread, stamped when it starts. Kept on the thread rather than
   * derived from the number, so history stays with the bot that answered it when a number is
   * later moved to another bot.
   */
  @Index('idx_wa_conversations_chatbot', ['chatbotId', 'lastMessageAt'])
  @Column({ type: 'uuid', name: 'chatbot_id', nullable: true })
  chatbotId?: string | null;

  /** The connector the thread came in through. Null on the platform number. */
  @Column({ type: 'uuid', name: 'connector_id', nullable: true })
  connectorId?: string | null;
}
