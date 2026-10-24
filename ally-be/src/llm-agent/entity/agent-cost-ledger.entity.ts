import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One priced model call made by an agent (plan §7.10 / Appendix A budgets).
 * Summed per thread, per learner per day and per anonymous visitor to drive
 * the budget tiers. `role` is the agent role that made the call (orchestrator,
 * sentinel, tutor…).
 */
@Entity('agent_cost_ledger')
export class AgentCostLedger {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  agentKey!: string;

  @Column({ type: 'uuid', nullable: true })
  threadId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  turnId?: string | null;

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'uuid', nullable: true })
  visitorId?: string | null;

  @Column({ type: 'varchar', length: 32 })
  role!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ type: 'varchar', length: 128 })
  model!: string;

  @Column({ type: 'int', default: 0 })
  promptTokens!: number;

  @Column({ type: 'int', default: 0 })
  completionTokens!: number;

  @Column({ type: 'int', default: 0 })
  cacheReadTokens!: number;

  @Column({ type: 'int', default: 0 })
  cacheCreationTokens!: number;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  usd!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
