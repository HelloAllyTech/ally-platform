import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { TrackEntrySource } from 'src/guide/enum/guide.enum';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('track_enrollments')
export class TrackEnrollment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid', nullable: true })
  tenantId?: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'int', default: 0 })
  completedItems!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt?: Date;

  /**
   * How the learner reached the course — public link, in-app, the Ally guide,
   * or an outreach reminder — so cohorts can be compared without a holdout
   * (plans/ally-guide/plan.md §2.1 decision 19). Null for enrollments made
   * before the column existed.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  entrySource?: TrackEntrySource | null;

  /**
   * The learner's chosen language for THIS course (a `languages.translationCode`
   * such as `hi`), so reading one course in Hindi does not mean switching the
   * whole app to Hindi. Null / `en` = the English source.
   *
   * This is also the only language grading trusts. Quiz fill-blank answers are
   * marked by string comparison and open-ended answers are graded against a
   * rubric, both of which are translated — so a submission is always marked
   * against the language stored here, never one named by the request, which a
   * client could otherwise mismatch against what it actually rendered.
   */
  @Column({ type: 'varchar', nullable: true })
  languageCode?: string | null;

  /**
   * Consolidated episodic memory for this learner's journey through the
   * track, folded from each conversation item's session memory
   * (TrackMemoryService): { summary, items: { [trackItemId]: { sessionId,
   * summary, updatedAt } }, updatedAt }. `summary` is what the next track
   * roleplay opens with.
   */
  @Column({ type: 'jsonb', nullable: true })
  memory?: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;
}
