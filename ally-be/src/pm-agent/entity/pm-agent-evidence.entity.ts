import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One evidence item fetched by a lane's tool in a run. A card may only cite evidence
 * created in its own run. `snapshot` is bounded and INTERNAL: it is shown to admins
 * but never copied into a compiled PRD/plan.md (those are public).
 */
@Entity('pm_agent_evidence')
@Index('idx_pm_agent_evidence_run', ['runId'])
export class PmAgentEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  /** analytics | ux_signals | code | roadmap | bug_hunter | llm_usage | context_library … */
  @Column({ type: 'varchar', length: 32 })
  source!: string;

  /** metric | chart | file | finding | chunk … */
  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ type: 'varchar', length: 200 })
  label!: string;

  @Column({ type: 'jsonb', nullable: true })
  query?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot?: unknown;

  @Column({ type: 'text', nullable: true })
  url?: string | null;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
