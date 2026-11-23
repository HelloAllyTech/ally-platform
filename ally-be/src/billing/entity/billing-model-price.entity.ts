import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

/** One version of a model's price. Never updated: a new price is a new row (CR1). */
@Entity('billing_model_prices')
@Index('uq_billing_model_prices_version', ['modelId', 'version'], {
  unique: true,
})
export class BillingModelPrice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'uuid' })
  modelId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  inputPer1MMicros!: number | null;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  cachedInputPer1MMicros!: number | null;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  outputPer1MMicros!: number | null;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  unitPriceMicros!: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  unit!: string | null;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'text' })
  note!: string;

  @Column({ type: 'int', nullable: true })
  createdBy!: number | null;
}
