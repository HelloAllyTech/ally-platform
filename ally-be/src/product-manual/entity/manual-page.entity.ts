import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ManualPageKind = 'section' | 'page';
/** `next` = merged to master but not yet in a tagged release ("ships in next release"). */
export type ManualReleaseState = 'live' | 'next';

/**
 * One page (or section heading) of the Product Manual. The manual lives ONLY in the database, never
 * in the repo, because the monorepo and the developer wiki are public. The current text is on this
 * row; every change is also a `manual_revisions` row, which is the visible change log.
 *
 * `search_vector` is a generated column (migration), so it is deliberately not mapped here.
 */
@Entity('manual_pages')
export class ManualPage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_manual_pages_slug', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** One or two plain sentences; shown in search results, the map and link previews. */
  @Column({ type: 'text', default: '' })
  summary!: string;

  /** Slug of the parent section, null for a top-level journey. */
  @Column({ name: 'parent_slug', type: 'varchar', length: 120, nullable: true })
  parentSlug?: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'varchar', length: 10, default: 'page' })
  kind!: ManualPageKind;

  /** Markdown. Cross-links are `[[slug]]` or `[[slug|label]]`. */
  @Column({ type: 'text', default: '' })
  body!: string;

  /** Who the page matters to (learner, counsellor, org admin, platform admin …). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  roles!: string[];

  /** Where in the product it happens (admin, helpline, mobile, ai-services …). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  surfaces!: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  journeys!: string[];

  @Column({
    name: 'release_state',
    type: 'varchar',
    length: 10,
    default: 'live',
  })
  releaseState!: ManualReleaseState;

  @Column({ name: 'next_since', type: 'timestamptz', nullable: true })
  nextSince?: Date | null;

  /** When an agent last checked this page against master, and which commit it read. */
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null;

  @Column({ name: 'verified_ref', type: 'varchar', length: 80, nullable: true })
  verifiedRef?: string | null;

  /** When the weekly agent last tried this page, finished or not. Pages tried lately queue last. */
  @Column({ name: 'last_attempt_at', type: 'timestamptz', nullable: true })
  lastAttemptAt?: Date | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
