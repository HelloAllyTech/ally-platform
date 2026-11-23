import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { numericTransformer } from '../util/numeric.transformer';

/** A monthly cost entered by hand on the Costs screen: hosting, database, subscriptions (CR1). */
@Entity('fixed_costs')
export class FixedCost extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** First day of the month. */
  @Column({ type: 'date' })
  month!: string;

  @Column({ type: 'varchar', length: 200 })
  label!: string;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    transformer: numericTransformer,
  })
  amountMicros!: number;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;
}
