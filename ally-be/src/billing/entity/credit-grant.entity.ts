import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../util/numeric.transformer';

export type CreditGrantKind = 'grant' | 'adjustment';

/**
 * Dollars Ally staff gave a builder's account, or took back (`adjustment`, negative). Append-only:
 * the grant history the builder sees. `idempotencyKey` makes the cutover grant safe to re-run.
 */
@Entity('credit_grants')
@Index('idx_credit_grants_account', ['accountId', 'createdAt'])
export class CreditGrant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @Column({
    type: 'numeric',
    precision: 20,
    scale: 3,
    name: 'amount_micros',
    transformer: numericTransformer,
  })
  amountMicros!: number;

  @Column({ type: 'varchar', length: 16 })
  kind!: CreditGrantKind;

  @Column({ type: 'text' })
  note!: string;

  /** The Ally staff member who granted it; null for the cutover script. */
  @Column({ type: 'int', name: 'granted_by', nullable: true })
  grantedBy!: number | null;

  /** The account's grant epoch this grant opened. */
  @Column({ type: 'int', default: 0 })
  epoch!: number;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'idempotency_key',
    nullable: true,
    unique: true,
  })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
