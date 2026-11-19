import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Who changed what, when and why: every CR1 admin change (models, prices, WhatsApp rates, settings,
 * fixed costs, tokens, plans, seat types, subscriptions, seats). Append-only.
 */
@Entity('billing_audit')
export class BillingAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'varchar', length: 40 })
  subjectType!: string;

  @Column({ type: 'varchar', length: 120 })
  subjectId!: string;

  @Column({ type: 'varchar', length: 40 })
  action!: string;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ type: 'text' })
  note!: string;

  @Column({ type: 'int', nullable: true })
  actorUserId!: number | null;
}
