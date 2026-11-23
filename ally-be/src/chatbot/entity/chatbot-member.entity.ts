import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ChatbotMemberRole } from '../enum/chatbot.enum';

/** A dashboard user who may see or manage one bot. One user can be a member of many bots. */
@Entity('chatbot_members')
@Index('uq_chatbot_members_bot_user', ['chatbotId', 'userId'], { unique: true })
export class ChatbotMember extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Index('idx_chatbot_members_user')
  @Column({ type: 'int', name: 'user_id' })
  userId!: number;

  /**
   * OLD single role, still written (dual write, Stage 1b): the highest of `roles` on the old
   * ladder, `viewer` for a responder-only member. Read `roles`. Dropped in a later release.
   */
  @Column({ type: 'varchar', length: 16 })
  role!: ChatbotMemberRole;

  /**
   * The member's roles, a non-empty set of owner, editor, responder, viewer (CHECK constraint).
   * A trigger keeps it and `role` in step when an instance on the old code writes only `role`.
   */
  @Column({ type: 'text', array: true })
  roles!: ChatbotMemberRole[];

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}
