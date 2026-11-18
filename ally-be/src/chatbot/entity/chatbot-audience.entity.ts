import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ChatbotAudienceKind } from '../enum/chatbot.enum';

/**
 * One entry on a bot's "who can chat" list, used when its access mode is `listed`. Kinds are
 * channel-neutral: a user or organisation entry works on any channel that can match a sender to an
 * Ally user; phone and email entries match the raw identifier.
 */
@Entity('chatbot_audience')
@Index('uq_chatbot_audience_entry', ['chatbotId', 'kind', 'value'], {
  unique: true,
})
export class ChatbotAudience extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: ChatbotAudienceKind;

  /** User id, tenant id, E.164 phone or lower-cased email, by kind. */
  @Column({ type: 'varchar', length: 255 })
  value!: string;

  /** What the admin sees: a name, organisation name or note. */
  @Column({ type: 'text', nullable: true })
  label?: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}
