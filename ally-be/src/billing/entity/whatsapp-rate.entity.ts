import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BillingStatus, WhatsAppRateCategory } from '../enum/billing.enum';
import { numericTransformer } from '../util/numeric.transformer';

/** Meta's rate for one delivered billable message, by category and recipient country, versioned (CR1). */
@Entity('whatsapp_rates')
@Index('uq_whatsapp_rates_version', ['category', 'country', 'version'], {
  unique: true,
})
export class WhatsAppRate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'varchar', length: 40 })
  category!: WhatsAppRateCategory;

  /** ISO 3166-1 alpha-2, upper case. */
  @Column({ type: 'varchar', length: 2 })
  country!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    transformer: numericTransformer,
  })
  priceMicros!: number;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'varchar', length: 20, default: BillingStatus.ACTIVE })
  status!: BillingStatus;

  @Column({ type: 'text' })
  note!: string;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;
}
