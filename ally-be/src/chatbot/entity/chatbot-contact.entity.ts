import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A person who chats with a bot, on any channel (Agents v2, chunk 12).
 *
 * Scoped to one bot: the same phone writing to two bots is two contacts, as a web visitor on two
 * bots' pages will be. How the contact is recognised on each channel is in
 * `chatbot_contact_identities`. Profile fields, relations and memory are chunks 7–8; WhatsApp
 * consent, blocking and the organisation link stay on `wa_contacts`.
 *
 * Copied from WhatsApp, the id is the `wa_contacts.id` it came from wherever that number has
 * written to one bot only (see `contactIdFor`).
 */
@Entity('chatbot_contacts')
export class ChatbotContact extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_chatbot_contacts_chatbot')
  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  /** What to call them. Null on WhatsApp, which records only the number today. */
  @Column({ type: 'text', name: 'display_name', nullable: true })
  displayName?: string | null;
}
