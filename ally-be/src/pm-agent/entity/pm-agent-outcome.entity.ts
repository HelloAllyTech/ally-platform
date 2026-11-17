import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { PmDecision } from '../enum/pm-agent.enum';

/**
 * Learning signal per decided card (plan §9b): the decision, its latency and reason
 * chip, and — for accepted cards — what happened next. Outcome beats opinion: an accepted
 * card that failed or was reverted is a negative label.
 *
 * Rows by `kind` (migration 1982000000500, UNIQUE (cardId, kind, day)):
 *  - `decision` (day 0): one per decided card — the decision and the build/release flags;
 *  - `impact` (day 0 = the 14-day pre-release baseline, 14, 30): impact-check reads of the
 *    card's `metricRef`, written at release by PmAgentImpactService.
 * Everything that reads decisions must filter `kind = 'decision'`.
 */
@Entity('pm_agent_outcomes')
@Unique('UQ_pm_agent_outcomes_card_kind_day', ['cardId', 'kind', 'day'])
export class PmAgentOutcome extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cardId!: string;

  /** `decision` | `impact` (CHECK). */
  @Column({ type: 'varchar', length: 16, default: 'decision' })
  kind!: 'decision' | 'impact';

  /** 0 for decision rows; impact rows: 0 = baseline, 14, 30 (CHECK). */
  @Column({ type: 'smallint', default: 0 })
  day!: number;

  /** Required on decision rows (CHECK); null on impact rows. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  decision!: PmDecision | null;

  @Column({ type: 'int', nullable: true })
  decidedBy?: number | null;

  /** Required on decision rows (CHECK); null on impact rows. */
  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

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

  /** Filed to the roadmap, then archived or removed there (migration 1982100000100). */
  @Column({ type: 'boolean', default: false })
  roadmapArchived!: boolean;

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

  // ── impact rows only ──────────────────────────────────────────────────────

  /** The card's metricRef as it was at release (source, params, unit, betterWhen). */
  @Column({ type: 'jsonb', nullable: true })
  metricRef?: Record<string, any> | null;

  /** The read window, UTC days, both ends inclusive. */
  @Column({ type: 'date', nullable: true })
  windowFrom?: string | null;

  @Column({ type: 'date', nullable: true })
  windowTo?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dueAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt?: Date | null;

  @Column({ type: 'double precision', nullable: true })
  value?: number | null;

  /** The baseline value this check is judged against (copied from the day-0 row). */
  @Column({ type: 'double precision', nullable: true })
  baseline?: number | null;

  @Column({ type: 'int', nullable: true })
  sampleSize?: number | null;

  /** pending | measured | insufficient_data | unavailable | not_measurable (CHECK). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  status?: string | null;

  /** improved | flat | worse, only when status = measured (CHECK). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  verdict?: string | null;

  /** Failed read attempts; MAX_ATTEMPTS makes the row `unavailable`. */
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  lastError?: string | null;
}
