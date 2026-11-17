import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * The PM Agent's singleton settings row (id = 1, CHECK in migration 1982000000000).
 * Seeded OFF: nothing runs and nothing is spent until an admin turns it on.
 *
 * `pauseAutoBuild` is the admin's switch; `autoBuildPaused` is the circuit breaker's,
 * set by code (N consecutive failed builds, or a failed release health check) and only
 * cleared by an admin. Either stops the agent STARTING builds; neither stops it
 * generating cards.
 */
@Entity('pm_agent_settings')
export class PmAgentSettings extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** USD per IST calendar month, the agent's own analysis only (builds are Builder's). */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 100 })
  monthlyBudgetUsd!: string;

  @Column({ type: 'int', default: 5 })
  queueCap!: number;

  /** Hour of the daily run, IST (0–23). */
  @Column({ type: 'int', default: 9 })
  runHourIst!: number;

  @Column({ type: 'text', default: '' })
  mandate!: string;

  @Column({ type: 'boolean', default: false })
  pauseAutoBuild!: boolean;

  @Column({ type: 'boolean', default: false })
  slackNotify!: boolean;

  /** category → weight; null = equal weights. */
  @Column({ type: 'jsonb', nullable: true })
  categoryWeights?: Record<string, number> | null;

  @Column({ type: 'boolean', default: false })
  autoBuildPaused!: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  autoBuildPausedReason?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  autoBuildPausedAt?: Date | null;

  /** Consecutive failed builds since the last success; the breaker trips at 3. */
  @Column({ type: 'int', default: 0 })
  consecutiveBuildFailures!: number;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
