import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import { ItemLinkSource, ItemLinkState } from '../enum/item-release.enum';

/**
 * A pull request that delivers (part of) a roadmap opportunity — migration
 * 1983100000000. Release tracking reads these to decide when the opportunity
 * is live (`ItemReleaseService`).
 *
 * Three ways in (`source`): the opportunity's Builder session opened it; its
 * title or branch carries the opportunity's code; or a person linked it as
 * "Built elsewhere". One row per pull request per opportunity, whichever way
 * it arrived first.
 *
 * Keyed by the full `repo` ("owner/name"), never by number alone: pull request
 * numbers restarted at #1 in the monorepo, so ally-be #704 and ally-platform
 * #704 are different changes.
 */
@Entity('item_linked_prs')
@Index(
  'idx_item_linked_prs_opp_repo_pr',
  ['opportunityId', 'repo', 'prNumber'],
  {
    unique: true,
  },
)
export class ItemLinkedPr extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to roadmap_opportunities, ON DELETE CASCADE. */
  @Column({ type: 'uuid' })
  opportunityId!: string;

  /** "owner/name" the pull request lives in. */
  @Column({ type: 'varchar', length: 120 })
  repo!: string;

  @Column({ type: 'int' })
  prNumber!: number;

  @Column({ type: 'text', nullable: true })
  prUrl?: string | null;

  @Column({ type: 'varchar', length: 12 })
  source!: ItemLinkSource;

  @Column({ type: 'varchar', length: 12, default: ItemLinkState.OPEN })
  state!: ItemLinkState;

  @Column({ type: 'text', nullable: true })
  title?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  branch?: string | null;

  /** The merge commit — what must be an ancestor of a release tag. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  mergeSha?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  mergedAt?: Date | null;

  /**
   * When the merged pull request's touched services were written as
   * `item_releases` rows. Null until then, and an opportunity cannot ship
   * while any merged link is null here: "we have not looked" is not "it
   * touched nothing".
   */
  @Column({ type: 'timestamp', nullable: true })
  servicesResolvedAt?: Date | null;

  /** Who linked it, for a manual link; null for the automatic ones. */
  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;
}
