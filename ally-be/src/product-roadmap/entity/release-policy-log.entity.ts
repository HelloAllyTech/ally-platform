import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import {
  ReleasePolicyBreakerEvent,
  ReleasePolicyComparison,
  ReleasePolicyDecision,
  ReleasePolicyLogKind,
  ReleasePolicyMode,
  ReleasePolicyOrigin,
  ReleasePolicyOutcome,
} from '../enum/release-policy.enum';
import type { HeldReason, PlanCommit } from '../util/release-policy.util';

/**
 * The auto-release policy's record (Roadmap v2, P5) — migration 1983500000000.
 * Platform-wide, so no tenant.
 *
 * Four kinds of row (`kind`):
 *  - `decision`: what the policy decided for one service, written only when
 *    the decision, its base or the service's newest commit changes. A
 *    `release` row in `shadow` mode is "would release `tag` with `commits`":
 *    one shadow cycle.
 *  - `observed_release`: a production release run that finished, whoever cut
 *    it, with its health and `comparison` against the policy's last decision
 *    before it started. The cutover check reads these.
 *  - `manual_release`: a Release click, with every commit it shipped.
 *  - `breaker`: tripped, would have tripped (shadow), or resumed.
 */
@Entity('release_policy_log')
@Index('idx_release_policy_log_kind_service_created', [
  'kind',
  'service',
  'createdAt',
])
export class ReleasePolicyLog extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: ReleasePolicyLogKind;

  @Column({ type: 'varchar', length: 8 })
  mode!: ReleasePolicyMode;

  /** be | ai | learn | frontend; null for a platform-wide breaker row. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  service?: string | null;

  /** For the frontend: admin | helpline | both. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  apps?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  decision?: ReleasePolicyDecision | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  breakerEvent?: ReleasePolicyBreakerEvent | null;

  /** Detail for a person reading the log: the held rules, what it waits for. */
  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  /** The newest successful production release the range starts from. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  baseRef?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  baseTag?: string | null;

  /** The master commit a decision was computed at, or a release run's head. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  headSha?: string | null;

  /** The newest commit in the range that touches the service. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  serviceHeadSha?: string | null;

  /** Would-be tag (shadow `release`), dispatched tag (click) or observed tag. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  tag?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  commits!: PlanCommit[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  heldReasons!: HeldReason[];

  /** Ideas linked to the commits in the range (`item_linked_prs`). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  opportunityIds!: string[];

  /** GitHub Actions run id; unique among `observed_release` rows. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  runId?: string | null;

  @Column({ type: 'text', nullable: true })
  runUrl?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  outcome?: ReleasePolicyOutcome | null;

  /** Null until checked, and when the service has no health URL. */
  @Column({ type: 'boolean', nullable: true })
  healthy?: boolean | null;

  @Column({ type: 'timestamp', nullable: true })
  healthCheckedAt?: Date | null;

  @Column({ type: 'int', default: 0 })
  healthAttempts!: number;

  @Column({ type: 'varchar', length: 12, nullable: true })
  origin?: ReleasePolicyOrigin | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  comparison?: ReleasePolicyComparison | null;

  /** The `decision` row an observed release was compared with. */
  @Column({ type: 'uuid', nullable: true })
  comparedDecisionId?: string | null;

  /** Who clicked Release or Resume. */
  @Column({ type: 'int', nullable: true })
  userId?: number | null;
}
