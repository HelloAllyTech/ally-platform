import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CounterSubject } from '../enum/billing.enum';

/**
 * One counter for one subject and period (CR1 Part C): a seat's messages, an assistant's customer
 * conversations, a creator's owner-side runs. Increments are idempotent through
 * `usage_counter_hits` (runId, kind).
 */
@Entity('usage_counters')
@Index(
  'UQ_usage_counters_subject_period',
  ['subjectType', 'subjectId', 'periodStart'],
  { unique: true },
)
export class UsageCounter extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30 })
  subjectType!: CounterSubject;

  @Column({ type: 'varchar', length: 120 })
  subjectId!: string;

  @Column({ type: 'date' })
  periodStart!: string;

  @Column({ type: 'date' })
  periodEnd!: string;

  @Column({ type: 'int', default: 0 })
  count!: number;

  @Column({ type: 'int', nullable: true })
  limitAtTime!: number | null;

  @Column({ type: 'timestamp', nullable: true })
  alerted80At!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  alerted100At!: Date | null;
}
