import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

export type FeedbackRating = 'up' | 'down';
export type FeedbackReason = 'wrong_info' | 'not_answered' | 'other';
export type FeedbackStatus = 'open' | 'fine' | 'corrected';

/**
 * A visitor's thumbs up or down on one assistant answer (chunk Q2a). One per answer: an answer
 * belongs to one visitor's conversation, and rating again changes it. Its own table rather than a
 * column on `chatbot_messages`, which is the shared store's append-only message log.
 */
@Entity('chatbot_message_feedback')
@Index('idx_chatbot_message_feedback_chatbot', [
  'chatbotId',
  'rating',
  'status',
  'createdAt',
])
export class ChatbotMessageFeedback extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id', type: 'uuid', unique: true })
  messageId!: string;

  @Column({ name: 'chatbot_id', type: 'uuid' })
  chatbotId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'varchar', length: 8 })
  rating!: FeedbackRating;

  @Column({ type: 'varchar', length: 16, nullable: true })
  reason?: FeedbackReason | null;

  /** "Tell us more (optional)", at most 300 characters. Never logged. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;

  /** A thumbs down the owner hasn't looked at, marked fine, or corrected. */
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: FeedbackStatus;

  @Column({ name: 'handled_by', type: 'int', nullable: true })
  handledBy?: number | null;

  @Column({ name: 'handled_at', type: 'timestamp', nullable: true })
  handledAt?: Date | null;
}
