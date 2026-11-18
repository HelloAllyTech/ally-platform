import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One configured way of reaching a bot: a WhatsApp number today, later a Slack workspace or an IVR
 * line. A connector serves at most one bot (`chatbotId`); a bot can have several connectors.
 *
 * Generic on purpose. The type-specific details live with the type — a WhatsApp connector's number,
 * credentials and webhook are a `wa_business_numbers` row pointing back here — so adding a type adds
 * a module, not columns.
 */
@Entity('connectors')
export class Connector extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** A key registered in ConnectorRegistry, e.g. `whatsapp`. */
  @Column({ type: 'varchar', length: 32 })
  type!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index('idx_connectors_chatbot', { where: '"deletedAt" IS NULL' })
  @Column({ type: 'uuid', name: 'chatbot_id', nullable: true })
  chatbotId?: string | null;

  /** Mirrors the type's own status (for WhatsApp: the number's). */
  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: string;

  /** Non-secret, type-specific settings. Secrets stay with the type's own encrypted store. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config!: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;

  @DeleteDateColumn()
  deletedAt?: Date;
}
