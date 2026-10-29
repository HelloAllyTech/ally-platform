import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  DebriefRunArm,
  DebriefRunMode,
  DebriefRunStatus,
} from '../enum/debrief-run.enum';

/** One step as it ran: what the Console's run timeline draws. */
export interface DebriefRunStepRecord {
  step: string;
  label: string;
  status: 'done' | 'failed' | 'skipped';
  startedAt: string;
  ms: number;
  model?: string | null;
  estimatedUsd?: number;
  round?: number;
  note?: string | null;
}

/**
 * One Debrief agent run (migration 1980810000000). `workspace` holds what the
 * steps produced — the safety reading, the evidence map, the progress reading,
 * the guidance passages' ids and the Evaluator's verdicts — so a run can be
 * read back step by step; `cards` is the draft that was (or would have been)
 * published. Quotes in both come from the learner's transcript, so the run is
 * read behind the transcripts permission, like the session itself.
 */
@Entity('debrief_runs')
@Index('debrief_runs_created_at_idx', ['createdAt'])
export class DebriefRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'varchar', length: 12 })
  mode!: DebriefRunMode;

  @Column({ type: 'varchar', length: 16, default: DebriefRunStatus.QUEUED })
  status!: DebriefRunStatus;

  @Column({ type: 'varchar', length: 40, nullable: true })
  skipReason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  releaseId?: string | null;

  @Column({ type: 'int', nullable: true })
  releaseVersion?: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  recipeKey?: string | null;

  /** The Improver idea (agent_lessons) a replay was screening. */
  @Column({ type: 'uuid', nullable: true })
  experimentId?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  arm?: DebriefRunArm | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  language?: string | null;

  @Column({ type: 'int', default: 0 })
  learnerTurns!: number;

  @Column({ type: 'boolean', default: false })
  hasRiskCue!: boolean;

  @Column({ type: 'boolean', default: false })
  learnerDistress!: boolean;

  @Column({ type: 'smallint', default: 0 })
  fallbackRung!: number;

  @Column({ type: 'smallint', default: 0 })
  revisionRounds!: number;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  ceilingUsd?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  estimatedCostUsd!: string;

  /** Reconciled from llm_usage after the run; null until then. */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  actualCostUsd?: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  evaluatorOverall?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evaluatorHardFails!: Array<{ code: string; evidence: string }>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  checkFailures!: Array<{ code: string; section: string; detail: string }>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  steps!: DebriefRunStepRecord[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  workspace!: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  cards?: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date | null;
}
