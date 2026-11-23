import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { numericTransformer } from '../util/numeric.transformer';

/**
 * One metered call on an assistant, or one billable WhatsApp message (CR1 Part A).
 *
 * Idempotent on (runId, kind, step, seq): a redelivered SQS message or a retried webhook writes
 * nothing twice. `costMicros` NULL means the model had no price covering the call's date; it is
 * filled in when one is added. `creatorUserId` is the assistant's creator: their plan and token
 * allowance pay for it.
 */
@Entity('usage_events')
@Index('uq_usage_events_run_kind_step_seq', ['runId', 'kind', 'step', 'seq'], {
  unique: true,
})
export class UsageEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** When the call happened (the provider's time, as reported). */
  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  recordedAt!: Date;

  @Column({ type: 'int', nullable: true })
  creatorUserId!: number | null;

  @Column({ type: 'uuid', nullable: true })
  chatbotId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  draftId!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  conversationId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  channel!: UsageChannel;

  @Column({ type: 'varchar', length: 120 })
  runId!: string;

  @Column({ type: 'int', default: 0 })
  step!: number;

  @Column({ type: 'int', default: 0 })
  seq!: number;

  @Column({ type: 'varchar', length: 30 })
  kind!: UsageKind;

  @Column({ type: 'varchar', length: 40, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  modelName!: string | null;

  @Column({ type: 'uuid', nullable: true })
  modelId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  priceId!: string | null;

  @Column({ type: 'int', default: 0 })
  inputTokens!: number;

  @Column({ type: 'int', default: 0 })
  cachedTokens!: number;

  @Column({ type: 'int', default: 0 })
  outputTokens!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  units!: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  unit!: string | null;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  costMicros!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  detail!: Record<string, unknown> | null;
}
