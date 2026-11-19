import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BillingModelType, BillingStatus } from '../enum/billing.enum';

/**
 * A model or paid service Ally can be billed for (CR1). Matched to usage by provider + model id.
 * Not the runtime pickers' `llm_models`: this list includes embeddings and transcription, and
 * nothing here changes which model any work uses.
 */
@Entity('billing_models')
@Index('uq_billing_models_provider_model', ['provider', 'model'], {
  unique: true,
})
export class BillingModel extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ type: 'varchar', length: 200 })
  model!: string;

  @Column({ type: 'varchar', length: 200 })
  label!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: BillingModelType;

  @Column({ type: 'varchar', length: 20, default: BillingStatus.ACTIVE })
  status!: BillingStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;
}
