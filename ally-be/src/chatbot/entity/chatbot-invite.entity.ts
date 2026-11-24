import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ChatbotMemberRole } from '../enum/chatbot.enum';

/**
 * An invite to a chatbot's team (Stage 1b), bound to one email. Only the SHA-256 of the emailed
 * token is stored. Pending = neither accepted nor revoked, and not past `expiresAt`.
 */
@Entity('chatbot_invites')
@Index('UQ_chatbot_invites_token_hash', ['tokenHash'], { unique: true })
export class ChatbotInvite extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  /** Lower-case (CHECK constraint). */
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ type: 'text', array: true })
  roles!: ChatbotMemberRole[];

  @Column({ type: 'int', name: 'invited_by', nullable: true })
  invitedBy?: number | null;

  @Column({ type: 'char', length: 64, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt?: Date | null;

  @Column({ type: 'int', name: 'accepted_user_id', nullable: true })
  acceptedUserId?: number | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'int', name: 'revoked_by', nullable: true })
  revokedBy?: number | null;
}
