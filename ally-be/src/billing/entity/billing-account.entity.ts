import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

export type BillingAccountStatus = 'active' | 'suspended';

/**
 * The payer (stage 6): one per builder. Every grant, chatbot budget and builder-side spend belongs
 * to an account, never to a bare user id, so ownership can move without moving money by hand.
 *
 * The four totals are counters kept in step with their rows in the same transaction (grants,
 * budgets, usage settled from `usage_events`), so the reservation can be one conditional UPDATE.
 * The nightly rebuild sets them from the rows. Free balance =
 * granted - setAside - builderSpent - reserved.
 */
@Entity('billing_accounts')
export class BillingAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', name: 'owner_user_id', unique: true })
  ownerUserId!: number;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: BillingAccountStatus;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'granted_micros',
    default: 0,
    transformer: numericTransformer,
  })
  grantedMicros!: number;

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
    name: 'builder_spent_micros',
    default: 0,
    transformer: numericTransformer,
  })
  builderSpentMicros!: number;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'reserved_micros',
    default: 0,
    transformer: numericTransformer,
  })
  reservedMicros!: number;

  /** Bumped by every grant: the warning emails re-arm per epoch. */
  @Column({ type: 'int', name: 'grant_epoch', default: 0 })
  grantEpoch!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
