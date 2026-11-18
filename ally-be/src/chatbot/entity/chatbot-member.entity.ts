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

  @Column({ type: 'varchar', length: 16 })
  role!: ChatbotMemberRole;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}
