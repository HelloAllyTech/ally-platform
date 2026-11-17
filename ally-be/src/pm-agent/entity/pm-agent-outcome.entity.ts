import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { PmDecision } from '../enum/pm-agent.enum';

/**
 * Learning signal per decided card (plan §9b): the decision, its latency and reason
 * chip, and — for accepted cards — what happened next. Outcome beats opinion: an accepted
 * card that failed or was reverted is a negative label. One row per card (UNIQUE cardId).
 * Impact-metric read-outs (+14/+30 d) are a follow-up; the columns exist so they need no
 * migration.
 */
@Entity('pm_agent_outcomes')
export class PmAgentOutcome extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  cardId!: string;

  @Column({ type: 'varchar', length: 16 })
  decision!: PmDecision;

  @Column({ type: 'int', nullable: true })
  decidedBy?: number | null;

  @Column({ type: 'timestamptz' })
  decidedAt!: Date;

  /** openedAt → decidedAt. */
  @Column({ type: 'int', nullable: true })
  decisionLatencyMs?: number | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  reasonChip?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  feedbackChips?: string[] | null;

  @Column({ type: 'boolean', default: false })
  undone!: boolean;

  @Column({ type: 'boolean', default: false })
  buildStarted!: boolean;

  @Column({ type: 'boolean', default: false })
  buildFailed!: boolean;

  @Column({ type: 'boolean', default: false })
  prOpened!: boolean;

  @Column({ type: 'boolean', default: false })
  merged!: boolean;

  @Column({ type: 'boolean', default: false })
  released!: boolean;

  @Column({ type: 'boolean', default: false })
  reverted!: boolean;

  @Column({ type: 'boolean', default: false })
  healthCheckFailed!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  impactMetricName?: string | null;

  @Column({ type: 'double precision', nullable: true })
  baselineValue?: number | null;

  @Column({ type: 'double precision', nullable: true })
  value14d?: number | null;

  @Column({ type: 'double precision', nullable: true })
  value30d?: number | null;

  /** Builder's cost for the build, copied from the session when it settles. */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  buildCostUsd?: string | null;
}
