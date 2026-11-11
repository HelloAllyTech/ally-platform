import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BotPageAccessKind } from '../enum/bot-page.enum';

/**
 * One entry on a bot page's access list: an invited email, or an organisation whose active users
 * may open an organisation-only page.
 *
 * Kept apart from `chatbot_audience` on purpose. That list decides who may chat on every channel;
 * the engine never reads this one, so adding someone to a page can't let them in on WhatsApp.
 */
@Entity('chatbot_page_access')
@Index('uq_chatbot_page_access_entry', ['pageId', 'kind', 'value'], {
  unique: true,
})
export class ChatbotPageAccess extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'page_id' })
  pageId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: BotPageAccessKind;

  /** A lower-cased email, or a tenant id. */
  @Column({ type: 'varchar', length: 256 })
  value!: string;

  /** What the admin sees: a name or organisation name. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  label?: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}
