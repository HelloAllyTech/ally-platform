import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DebriefRunLogKind } from '../enum/debrief-run.enum';

/**
 * One Agent logs entry of a Debrief agent run (migration 1981901000000): a
 * model call's exact message and full reply, or a deciding code step's real
 * inputs and results. Append-only; deleted with its run (and so with its
 * session). For the Ally team only: `GET /v1/debriefs/console/runs/:id/logs`.
 */
@Entity('debrief_run_logs')
@Index('debrief_run_logs_run_seq_uq', ['runId', 'seq'], { unique: true })
export class DebriefRunLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  /** The order the entries started in, from 1. */
  @Column({ type: 'int' })
  seq!: number;

  /** The step or agent: `writer`, `planner`, `dispatch`, `judge`, … */
  @Column({ type: 'varchar', length: 60 })
  step!: string;

  @Column({ type: 'int', nullable: true })
  round?: number | null;

  @Column({ type: 'varchar', length: 8 })
  kind!: DebriefRunLogKind;

  /** The model the step asked for first. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  model?: string | null;

  /** The backup or fallback that ran instead, when one did. */
  @Column({
    name: 'fallback_model',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  fallbackModel?: string | null;

  /** The Skills Store prompt the message carries, as `{{system_prompt}}`. */
  @Column({ name: 'prompt_code', type: 'varchar', length: 120, nullable: true })
  promptCode?: string | null;

  /** Its version; null when the run had no live text for it (the code's default was sent whole). */
  @Column({ name: 'prompt_version', type: 'int', nullable: true })
  promptVersion?: number | null;

  /** Model steps: the message exactly as sent (a JSON string). Code steps: the inputs. */
  @Column({ type: 'jsonb', nullable: true })
  input?: any;

  /** Model steps: the full reply. Code steps: the results. */
  @Column({ type: 'jsonb', nullable: true })
  output?: any;

  @Column({ name: 'tokens_in', type: 'int', nullable: true })
  tokensIn?: number | null;

  @Column({ name: 'tokens_out', type: 'int', nullable: true })
  tokensOut?: number | null;

  @Column({
    name: 'cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
  })
  costUsd?: string | null;

  @Column({ type: 'int', nullable: true })
  ms?: number | null;

  @Column({ type: 'int', default: 0 })
  retries!: number;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /** Needs a look: a failed check, below the bar, an error. */
  @Column({ type: 'boolean', default: false })
  attention!: boolean;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
