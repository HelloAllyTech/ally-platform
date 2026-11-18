import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ConversationChannel } from '../enum/conversation.enum';

/**
 * How a contact is recognised on one channel: a phone on WhatsApp, a visitor id on the web, an
 * address for email.
 *
 * Unique per (channel, value, bot), which is what makes a contact bot-scoped. `chatbot_id` repeats
 * the contact's own so the unique index can hold it.
 */
@Entity('chatbot_contact_identities')
@Index(
  'uq_chatbot_contact_identities_channel_external',
  ['channel', 'externalId', 'chatbotId'],
  { unique: true },
)
export class ChatbotContactIdentity extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_chatbot_contact_identities_contact')
  @Column({ type: 'uuid', name: 'contact_id' })
  contactId!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: ConversationChannel;

  /**
   * The phone (E.164, no '+'), visitor id or email. Blanked to `erased:<id>` by erasure and
   * retention, as `wa_contacts.phone_e164` is.
   */
  @Column({ type: 'varchar', length: 256, name: 'external_id' })
  externalId!: string;

  /** True when the channel vouches for it: WhatsApp delivered from that number, or a code was entered. */
  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ type: 'timestamp', name: 'verified_at', nullable: true })
  verifiedAt?: Date | null;
}
