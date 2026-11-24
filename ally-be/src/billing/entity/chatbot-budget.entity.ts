import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

/**
 * What a builder set aside from their free balance for one chatbot's customers (D1, R2). Customer
 * spend comes only from here; building and testing never touch it. Remaining =
 * setAside - spent - reserved.
 *
 * One open row per chatbot (a partial unique index). Archiving clamps `setAside` to `spent`, which
 * returns the unspent part to the free balance and keeps the row as history; a transfer archives
 * this row and opens one on the receiving account.
 */
@Entity('chatbot_budgets')
export class ChatbotBudget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @Column({ type: 'uuid', name: 'chatbot_id' })
  chatbotId!: string;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'set_aside_micros',
    default: 0,
    transformer: numericTransformer,
  })
  setAsideMicros!: number;

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

  /** Bumped by every top-up: the budget's warning emails re-arm per epoch. */
  @Column({ type: 'int', default: 0 })
  epoch!: number;

  @Column({ type: 'timestamp', name: 'archived_at', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
