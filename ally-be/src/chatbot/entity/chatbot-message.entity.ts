import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AgentRuntimeUsed } from '../enum/chatbot.enum';
import {
  ConversationChannel,
  ConversationMessageRole,
} from '../enum/conversation.enum';
import {
  WaHandledBy,
  WaMessageDirection,
  WaMessageStatus,
} from '../../whatsapp/enum/whatsapp.enum';

/**
 * One message in a conversation, on any channel.
 *
 * The columns follow `wa_messages`, so the dashboard can move to this table without losing
 * anything (chunk 12b). Copied from WhatsApp, the id and `createdAt` are the `wa_messages` ones:
 * history is read back in `createdAt` order, so the copy must not re-stamp it. `text` holds what
 * a person wrote, the most sensitive column here; retention and erasure blank it as they blank
 * `wa_messages.body`.
 */
@Entity('chatbot_messages')
@Index('idx_chatbot_messages_conversation', ['conversationId', 'createdAt'])
@Index('uq_chatbot_messages_provider_id', ['channel', 'providerMessageId'], {
  unique: true,
  where: '"provider_message_id" IS NOT NULL',
})
export class ChatbotMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;

  /** The conversation's channel, repeated so the provider id can be unique per channel. */
  @Column({ type: 'varchar', length: 16 })
  channel!: ConversationChannel;

  @Column({ type: 'varchar', length: 16 })
  direction!: WaMessageDirection;

  @Column({ type: 'varchar', length: 16 })
  role!: ConversationMessageRole;

  @Column({ type: 'text' })
  text!: string;

  /** Files and media on the message (chunks 9–10). */
  @Column({ type: 'jsonb', nullable: true })
  attachments?: Record<string, any>[] | null;

  @Column({ type: 'varchar', length: 24, name: 'handled_by', nullable: true })
  handledBy?: WaHandledBy | null;

  @Column({ type: 'jsonb', nullable: true })
  citations?: Record<string, any>[] | null;

  /** What retrieval did, as on `wa_messages`; includes `turn_type` for agent replies. */
  @Column({ type: 'jsonb', name: 'retrieval_meta', nullable: true })
  retrievalMeta?: Record<string, any> | null;

  @Column({ type: 'uuid', name: 'agent_run_id', nullable: true })
  agentRunId?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'agent_runtime',
    nullable: true,
  })
  agentRuntime?: AgentRuntimeUsed | null;

  /** The provider's id: the dedupe key, unique per channel. Null until an outbound send succeeds. */
  @Column({
    type: 'varchar',
    length: 128,
    name: 'provider_message_id',
    nullable: true,
  })
  providerMessageId?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: WaMessageStatus.RECEIVED,
  })
  status!: WaMessageStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  language?: string | null;

  @Column({ type: 'uuid', name: 'template_id', nullable: true })
  templateId?: string | null;

  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs?: number | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage?: string | null;

  /** For an outbound message, the inbound message it answers. */
  @Column({ type: 'uuid', name: 'in_reply_to_id', nullable: true })
  inReplyToId?: string | null;

  /** The team member who wrote an `agent_human` message (chunk 11a). */
  @Column({ type: 'int', name: 'sent_by_user_id', nullable: true })
  sentByUserId?: number | null;
}
