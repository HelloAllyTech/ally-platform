import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** One cohort's numbers in a baseline snapshot. Rates are 0–1. */
export interface GuideBaselineCohortMetrics {
  enrollments: number;
  completionRate: number | null;
  medianDaysToComplete: number | null;
  itemsCompletedPerEnrollment: number | null;
  /** At least one item completed within a day of starting (plan §4.5). */
  firstDayWinRate: number | null;
  /** Came back and completed something on a later day within a week. */
  returnWithin7dRate: number | null;
  quizFirstAttempts: number;
  quizFirstAttemptPassRate: number | null;
}

export interface GuideBaselineMetrics {
  /** Keyed by entry source: public_link, in_app, guided, outreach, unknown, all. */
  cohorts: Record<string, GuideBaselineCohortMetrics>;
  publicCourses: number;
  definitions: Record<string, string>;
}

/**
 * Platform aggregates for public courses over a window (plan decision 19):
 * the baseline the guided experience is compared against, in place of a
 * classic holdout. Never per learner.
 */
@Entity('guide_baseline_snapshots')
export class GuideBaselineSnapshot extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  windowDays!: number;

  @Column({ type: 'timestamp' })
  windowStart!: Date;

  @Column({ type: 'timestamp' })
  windowEnd!: Date;

  @Column({ type: 'int', nullable: true })
  capturedByUserId?: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'jsonb' })
  metrics!: GuideBaselineMetrics;
}
