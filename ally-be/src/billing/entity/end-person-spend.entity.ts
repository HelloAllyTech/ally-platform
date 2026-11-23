import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

export type SpendPeriodKind = 'day' | 'week' | 'month';

/**
 * One end person's spend on one chatbot in one day, week or month, the period starting in the
 * chatbot's time zone. Checked against the chatbot's `userLimits`; rebuilt nightly from the events.
 */
@Entity('end_person_spend')
export class EndPersonSpend {
  @PrimaryColumn({ type: 'uuid', name: 'end_person_id' })
  endPersonId!: string;

  @PrimaryColumn({ type: 'varchar', length: 8, name: 'period_kind' })
  periodKind!: SpendPeriodKind;

  @PrimaryColumn({ type: 'date', name: 'period_start' })
  periodStart!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'spent_micros',
    default: 0,
    transformer: numericTransformer,
  })
  spentMicros!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'reserved_micros',
    default: 0,
    transformer: numericTransformer,
  })
  reservedMicros!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
