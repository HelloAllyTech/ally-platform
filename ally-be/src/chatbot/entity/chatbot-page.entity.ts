import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BotPageAccess, BotPageStatus } from '../enum/bot-page.enum';
import type { BotPageSettings } from '../type/bot-page.type';

/**
 * A bot's page: a branded chat link at `<BOT_PAGE_BASE_URL>/b/<slug>` (chunk 12b).
 *
 * One per bot. The slug is unique ignoring case (`uq_chatbot_pages_slug` is on `lower(slug)`, so
 * it is declared in the migration, not here). Who may open an organisation-only or invite-only page
 * is in `chatbot_page_access`.
 */
@Entity('chatbot_pages')
@Index('uq_chatbot_pages_chatbot', ['chatbotId'], { unique: true })
export class ChatbotPage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({ type: 'varchar', length: 48 })
  slug!: string;

  @Column({ type: 'varchar', length: 16, default: BotPageStatus.OFF })
  status!: BotPageStatus;

  @Column({ type: 'varchar', length: 16, default: BotPageAccess.INVITE })
  access!: BotPageAccess;

  /** Branding, pre-chat and suggested questions, limits and language. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  settings!: BotPageSettings;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;
}
