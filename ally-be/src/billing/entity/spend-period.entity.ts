import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

/**
 * What a creator's assistants have cost Ally in one plan period: the running total the spend cap
 * is checked against. Kept in step with `usage_events` in the same transaction, and corrected
 * nightly from the events themselves.
 */
@Entity('spend_periods')
export class SpendPeriod {
  @PrimaryColumn({ type: 'int' })
  userId!: number;

  @PrimaryColumn({ type: 'date' })
  periodStart!: string;

  @Column({ type: 'date' })
  periodEnd!: string;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  costMicros!: number;

  @Column({ type: 'timestamp', nullable: true })
  alerted80At!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  alerted100At!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
