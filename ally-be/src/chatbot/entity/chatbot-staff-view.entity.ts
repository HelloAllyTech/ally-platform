import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Assistants stage 8: one Ally staff read of a chatbot, written BEFORE the read is served (the
 * read is refused when this row cannot be written). Owners see these under "Who looked".
 * `chatbot_id` is null only for the staff search across chatbots.
 */
@Entity('chatbot_staff_views')
@Index('IDX_chatbot_staff_views_bot_at', ['chatbotId', 'viewedAt'])
export class ChatbotStaffView {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id', nullable: true })
  chatbotId?: string | null;

  @Column({ type: 'int', name: 'staff_user_id' })
  staffUserId!: number;

  /** `setup`, `conversations` or `search`. */
  @Column({ type: 'varchar', length: 24 })
  policy!: string;

  /** e.g. `GET /v1/inbox/chatbots/:chatbotId/conversations/:id`. */
  @Column({ type: 'varchar', length: 255 })
  route!: string;

  /** `Controller.handler`, the staff-access matrix key. */
  @Column({ type: 'varchar', length: 128 })
  handler!: string;

  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId?: string | null;

  /** Another subject the read named: a contact, a list record, or the search text. */
  @Column({ type: 'varchar', length: 255, name: 'target', nullable: true })
  target?: string | null;

  @Column({ type: 'uuid', name: 'grant_id', nullable: true })
  grantId?: string | null;

  @Column({ type: 'timestamptz', name: 'viewed_at', default: () => 'now()' })
  viewedAt!: Date;
}
