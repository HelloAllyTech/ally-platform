import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DebriefProbeStatus = 'done' | 'unscored' | 'failed';

/**
 * One paired trial on a production session (v9 FR-58/FR-59; migration
 * 1981002100000): after a debrief was published, a challenger debrief nobody
 * sees was written for the same session (a replay run) and both were judged
 * blind. Unique per idea and session. Paid from the learning budget.
 */
@Entity('debrief_probe_results')
export class DebriefProbeResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid' })
  ideaId!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'uuid' })
  baselineRunId!: string;

  @Column({ type: 'uuid', nullable: true })
  challengerRunId?: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  baselineOverall?: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  challengerOverall?: string | null;

  @Column({ type: 'int', default: 0 })
  baselineHardFails!: number;

  @Column({ type: 'int', default: 0 })
  challengerHardFails!: number;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  costUsd!: string;

  @Column({ type: 'varchar', length: 12 })
  status!: DebriefProbeStatus;
}
