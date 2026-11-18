import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import { ItemReleaseState } from '../enum/item-release.enum';

/**
 * Whether one service's production release contains one merged pull request
 * linked to an opportunity — migration 1983100000000.
 *
 * `live` means the merge commit is an ancestor of the newest SUCCESSFUL
 * production release tag for the service (GitHub compare: `behind` or
 * `identical`). It does not matter how the release was cut — Builder,
 * Bug Hunter, `/ship` or a person — only that it succeeded.
 *
 * An opportunity is shipped when every row for every merged pull request is
 * live (`opportunityShipped`). The unique key carries `repo` beside the
 * brief's (opportunity, PR number, service): pull request numbers restarted at
 * #1 in the monorepo.
 */
@Entity('item_releases')
@Index(
  'idx_item_releases_opp_repo_pr_service',
  ['opportunityId', 'repo', 'prNumber', 'service'],
  { unique: true },
)
@Index('idx_item_releases_state', ['state'])
export class ItemRelease extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to roadmap_opportunities, ON DELETE CASCADE. */
  @Column({ type: 'uuid' })
  opportunityId!: string;

  @Column({ type: 'varchar', length: 120 })
  repo!: string;

  @Column({ type: 'int' })
  prNumber!: number;

  /** be | ai | learn | frontend | mobile | none (`RELEASE_SERVICES`). */
  @Column({ type: 'varchar', length: 12 })
  service!: string;

  /** For `frontend` only: admin | helpline | both — the dashboards the change ships in. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  apps?: string | null;

  @Column({ type: 'varchar', length: 64 })
  mergeSha!: string;

  @Column({ type: 'timestamp', nullable: true })
  mergedAt?: Date | null;

  /** The release tag that contains it, once live. Null while pending. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  tag?: string | null;

  /**
   * When it reached production: the end of the first successful release that
   * started after the merge. Null while pending, and when that release is
   * older than the history read.
   */
  @Column({ type: 'timestamp', nullable: true })
  releasedAt?: Date | null;

  @Column({ type: 'varchar', length: 10, default: ItemReleaseState.PENDING })
  state!: ItemReleaseState;

  /**
   * The release ref(s) this row was last compared against. A pending row is
   * only compared again when its service's newest successful release has
   * moved, so a quiet day costs no compare calls.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  checkedRef?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt?: Date | null;
}
