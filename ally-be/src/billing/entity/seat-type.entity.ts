import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { numericTransformer } from '../util/numeric.transformer';

/** A seat type (CR1 Part C): Basic, Premium, or any added on the Plans screen. */
@Entity('seat_types')
export class SeatType extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** NULL: unlimited. */
  @Column({ type: 'int', nullable: true })
  messagesPerMonth!: number | null;

  @Column({ type: 'int', default: 1 })
  rank!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  priceMicros!: number | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;
}
