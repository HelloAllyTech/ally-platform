import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The only scope today: Ally staff may read this chatbot's conversations. */
export const STAFF_GRANT_SCOPE = 'ally_staff' as const;

/**
 * Assistants stage 8: an owner's time-limited permission for Ally staff to read the chatbot's
 * conversations, memory and contacts. Live while `revoked_at` is null and `expires_at` is ahead.
 */
@Entity('chatbot_access_grants')
@Index('IDX_chatbot_access_grants_bot_expires', ['chatbotId', 'expiresAt'])
export class ChatbotAccessGrant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'int', name: 'granted_by' })
  grantedBy!: number;

  @Column({ type: 'varchar', length: 32, default: STAFF_GRANT_SCOPE })
  scope!: typeof STAFF_GRANT_SCOPE;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'int', name: 'revoked_by', nullable: true })
  revokedBy?: number | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
