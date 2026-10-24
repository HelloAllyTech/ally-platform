import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One case, one repetition, one release, inside an eval run. `checks` lists
 * every check with its verdict; `output` is the replayed reply and tool
 * calls (for a mined case it may echo the learner's redacted words, so it is
 * read only behind the transcripts permission).
 */
@Entity('agent_eval_results')
@Index('idx_agent_eval_results_run', ['runId'])
export class AgentEvalResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  @Column({ type: 'uuid' })
  caseId!: string;

  @Column({ type: 'uuid' })
  releaseId!: string;

  @Column({ type: 'int', default: 1 })
  repetition!: number;

  @Column({ type: 'boolean' })
  passed!: boolean;

  @Column({ type: 'boolean', default: false })
  safetyFailed!: boolean;

  /** Share of quality checks passed, 0–1. */
  @Column({ type: 'real', nullable: true })
  quality?: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  checks!: Record<string, any>[];

  @Column({ type: 'jsonb', nullable: true })
  output?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'int', nullable: true })
  latencyMs?: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
