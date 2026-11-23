import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

/** Singleton (id = 1): the Costs screen's budget and alert thresholds (CR1). */
@Entity('cost_settings')
export class CostSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    transformer: numericTransformer,
  })
  dailyBudgetMicros!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    transformer: numericTransformer,
  })
  conversationAlertMicros!: number;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    transformer: numericTransformer,
  })
  spikeMultiplier!: number;

  /** A spike alert also needs the assistant's cost today over this (decided at the CR1 plan stop: $1). */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    transformer: numericTransformer,
  })
  spikeMinMicros!: number;

  @Column({ type: 'int', nullable: true })
  updatedBy!: number | null;
}
