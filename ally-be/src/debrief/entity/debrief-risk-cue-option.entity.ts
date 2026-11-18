import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

export type RiskCueHandling = 'alarm' | 'assessed';
export type RiskCueOptionStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'retired';

/** Example lines that are, and are not, risk cues for this kind of roleplay: the option's own test. */
export interface RiskCueExamples {
  cues: string[];
  nonCues: string[];
}

/** One earlier version of an option, kept when an approved option is changed. */
export interface RiskCueOptionVersion {
  version: number;
  name: string;
  wording: string | null;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  examples: RiskCueExamples;
  approvedBy: number | null;
  approvedAt: string | null;
}

/**
 * A risk-cue option (migration 1982100000000; spec DEBRIEF_ACROSS_ROLEPLAYS §5): a roleplay's
 * Debrief reads its wording and applies its behaviour. `wording` null means the pinned definition.
 */
@Entity('debrief_risk_cue_options')
export class DebriefRiskCueOption extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'text', nullable: true })
  wording?: string | null;

  @Column({ type: 'varchar', length: 12, default: 'alarm' })
  handling!: RiskCueHandling;

  @Column({ type: 'boolean', default: true })
  wordListRaises!: boolean;

  @Column({ type: 'boolean', default: true })
  supportLinesOnCue!: boolean;

  @Column({ type: 'jsonb', default: () => `'{"cues":[],"nonCues":[]}'::jsonb` })
  examples!: RiskCueExamples;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status!: RiskCueOptionStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  /** The last safety test: `{ passed, runs, at, found, planted, falseAlarms, ... }`. */
  @Column({ type: 'jsonb', nullable: true })
  testResult?: Record<string, any> | null;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  history!: RiskCueOptionVersion[];

  /** Why a clinical advisor turned it down, or what they changed. */
  @Column({ type: 'text', nullable: true })
  reviewNote?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ type: 'int', nullable: true })
  approvedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date | null;
}
