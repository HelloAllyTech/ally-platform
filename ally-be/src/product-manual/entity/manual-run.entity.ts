import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ManualRunStatus = 'running' | 'done' | 'failed' | 'skipped';

/** One weekly (or run-now) pass of the manual agent. At most one `running` row exists at a time. */
@Entity('manual_runs')
export class ManualRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 12 })
  trigger!: 'scheduled' | 'manual';

  @Column({ type: 'varchar', length: 10, default: 'running' })
  status!: ManualRunStatus;

  /** Why a run was skipped or stopped early: disabled | budget_exhausted | already_running | cap. */
  @Column({ name: 'stop_reason', type: 'varchar', length: 30, nullable: true })
  stopReason?: string | null;

  @Column({
    name: 'reserved_usd',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: 0,
  })
  reservedUsd!: string;

  @Column({
    name: 'spent_usd',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: 0,
  })
  spentUsd!: string;

  @Column({ name: 'pages_touched', type: 'int', default: 0 })
  pagesTouched!: number;

  @Column({ name: 'proposals_applied', type: 'int', default: 0 })
  proposalsApplied!: number;

  @Column({ type: 'text', nullable: true })
  summary?: string | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ name: 'triggered_by', type: 'int', nullable: true })
  triggeredBy?: number | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;
}
