import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

export type ReservationState = 'reserved' | 'settled' | 'released';
export type CreditFunding = 'free' | 'budget';

/**
 * Money held for one run before its model calls (the ledger rule in section 3). Taken by one
 * conditional UPDATE, so concurrent turns cannot all pass on a small budget. Usage recorded for
 * the run consumes it; whatever is left when it expires goes back.
 *
 * The run id is the one sent to ally-ai (derived from the WhatsApp message id, or the web message
 * id), so a retried message finds its reservation instead of taking a second one. The payer is
 * stamped here when the run starts.
 */
@Entity('credit_reservations')
export class CreditReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, name: 'run_id', unique: true })
  runId!: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @Column({ type: 'uuid', name: 'chatbot_id', nullable: true })
  chatbotId!: string | null;

  @Column({ type: 'uuid', name: 'end_person_id', nullable: true })
  endPersonId!: string | null;

  @Column({ type: 'varchar', length: 10 })
  funding!: CreditFunding;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'reserved_micros',
    transformer: numericTransformer,
  })
  reservedMicros!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'consumed_micros',
    default: 0,
    transformer: numericTransformer,
  })
  consumedMicros!: number;

  @Column({ type: 'varchar', length: 10, default: 'reserved' })
  state!: ReservationState;

  /** The person-limit periods this reservation also holds money in. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  periods!: Array<{ kind: 'day' | 'week' | 'month'; start: string }>;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', name: 'settled_at', nullable: true })
  settledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
