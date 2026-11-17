import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The run trace: one row per bounded step (a lane's model call, the critic, the ranker,
 * a gate verdict), with the prompt code and version pinned so any card is reproducible.
 */
@Entity('pm_agent_run_steps')
@Index('idx_pm_agent_run_steps_run', ['runId'])
export class PmAgentRunStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'varchar', length: 32 })
  lane!: string;

  /** lane | critic | ranker | gate | tool */
  @Column({ type: 'varchar', length: 16 })
  kind!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  promptCode?: string | null;

  @Column({ type: 'int', nullable: true })
  promptVersion?: number | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  model?: string | null;

  @Column({ type: 'int', default: 0 })
  tokensIn!: number;

  @Column({ type: 'int', default: 0 })
  tokensOut!: number;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  costUsd!: string;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  reservedUsd!: string;

  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: unknown[] | null;

  @Column({ type: 'int', nullable: true })
  latencyMs?: number | null;

  /** ok | discarded | failed | skipped | budget */
  @Column({ type: 'varchar', length: 16 })
  outcome!: string;

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
