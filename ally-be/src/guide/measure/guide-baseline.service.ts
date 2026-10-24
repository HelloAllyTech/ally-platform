import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { userNames } from '../admin/user-names';
import {
  GuideBaselineCohortMetrics,
  GuideBaselineMetrics,
  GuideBaselineSnapshot,
} from '../entity/guide-baseline-snapshot.entity';

const DEFINITIONS: Record<string, string> = {
  scope:
    'Enrollments started in the window on courses whose public link is on (the courses that go guided).',
  cohort:
    "track_enrollments.entrySource; 'unknown' is every enrollment from before entry sources were recorded.",
  completionRate: 'Share of those enrollments completed so far.',
  medianDaysToComplete: 'Median days from start to completion, completed only.',
  firstDayWinRate:
    'Share with at least one item completed within 24 h of starting.',
  returnWithin7dRate:
    'Share that completed something on a later calendar day within 7 days of starting.',
  quizFirstAttemptPassRate:
    'Share of first attempts at a quiz that passed (pending grades left out).',
};

const COHORT_SQL = `
WITH e AS (
  SELECT te."id", te."startedAt", te."completedAt", te."completedItems",
         COALESCE(te."entrySource", 'unknown') AS "cohort"
    FROM "track_enrollments" te
    JOIN "tracks" t ON t."id" = te."trackId"
   WHERE te."deletedAt" IS NULL AND t."isPublicView" = true
     AND te."startedAt" >= $1 AND te."startedAt" < $2
),
done AS (
  SELECT tip."trackEnrollmentId" AS "eid", tip."completedAt"
    FROM "track_item_progress" tip
    JOIN e ON e."id" = tip."trackEnrollmentId"
   WHERE tip."status" = 'COMPLETED' AND tip."completedAt" IS NOT NULL
     AND tip."deletedAt" IS NULL
),
per AS (
  SELECT e.*,
    EXISTS (SELECT 1 FROM done d WHERE d."eid" = e."id"
             AND d."completedAt" < e."startedAt" + interval '1 day') AS "dayWin",
    EXISTS (SELECT 1 FROM done d WHERE d."eid" = e."id"
             AND d."completedAt"::date > e."startedAt"::date
             AND d."completedAt" < e."startedAt" + interval '7 days') AS "returned"
    FROM e
)
SELECT "cohort",
  COUNT(*)::int AS "enrollments",
  AVG(("completedAt" IS NOT NULL)::int)::float AS "completionRate",
  (PERCENTILE_CONT(0.5) WITHIN GROUP (
     ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) / 86400
   ) FILTER (WHERE "completedAt" IS NOT NULL))::float AS "medianDaysToComplete",
  AVG("completedItems")::float AS "itemsCompletedPerEnrollment",
  AVG("dayWin"::int)::float AS "firstDayWinRate",
  AVG("returned"::int)::float AS "returnWithin7dRate"
  FROM per
 GROUP BY ROLLUP ("cohort")`;

const QUIZ_SQL = `
SELECT COALESCE(te."entrySource", 'unknown') AS "cohort",
  COUNT(*)::int AS "attempts",
  AVG((a."passed" IS TRUE)::int)::float AS "passRate"
  FROM "track_quiz_attempts" a
  JOIN "track_item_progress" tip ON tip."id" = a."trackItemProgressId"
  JOIN "track_enrollments" te ON te."id" = tip."trackEnrollmentId"
  JOIN "tracks" t ON t."id" = te."trackId"
 WHERE a."attemptNumber" = 1 AND a."deletedAt" IS NULL
   AND a."status" <> 'PENDING_GRADING'
   AND te."deletedAt" IS NULL AND t."isPublicView" = true
   AND te."startedAt" >= $1 AND te."startedAt" < $2
 GROUP BY ROLLUP (COALESCE(te."entrySource", 'unknown'))`;

const round = (value: number | null | undefined, places = 4) =>
  value == null || Number.isNaN(Number(value))
    ? null
    : Number(Number(value).toFixed(places));

/**
 * The pre-launch baseline (plans/ally-guide/plan.md decision 19, §4.13,
 * §13.3): with no classic holdout, Ally is judged against how public courses
 * already did. Captured by an admin before launch and whenever useful after;
 * every snapshot is kept, so later ones can be read against the first.
 *
 * Historical enrollments carry no entry source, so before launch everything
 * is the 'unknown' cohort. From launch, classic enrollments are tagged
 * public_link or in_app and Ally's guided, so each later snapshot splits.
 */
@Injectable()
export class GuideBaselineService {
  constructor(
    @InjectRepository(GuideBaselineSnapshot)
    private readonly snapshots: Repository<GuideBaselineSnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  async capture(input: {
    windowDays: number;
    userId: number | null;
    note?: string | null;
  }): Promise<GuideBaselineSnapshot> {
    const windowDays = Math.floor(input.windowDays);
    if (!Number.isFinite(windowDays) || windowDays < 7 || windowDays > 365) {
      throw new BadRequestException('windowDays must be between 7 and 365');
    }
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowDays * 86_400_000);
    // ISO instants converted in SQL: the columns are timestamps holding UTC.
    const range = [windowStart.toISOString(), windowEnd.toISOString()];
    const asUtc = (sql: string) =>
      sql
        .replace(/\$1/g, "($1::timestamptz AT TIME ZONE 'UTC')")
        .replace(/\$2/g, "($2::timestamptz AT TIME ZONE 'UTC')");
    const [rows, quiz, courses] = await Promise.all([
      this.dataSource.query(asUtc(COHORT_SQL), range) as Promise<
        Array<Record<string, any>>
      >,
      this.dataSource.query(asUtc(QUIZ_SQL), range) as Promise<
        Array<{ cohort: string | null; attempts: number; passRate: number }>
      >,
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "n" FROM "tracks" WHERE "isPublicView" = true AND "deletedAt" IS NULL`,
      ) as Promise<Array<{ n: number }>>,
    ]);
    const quizBy = new Map(
      quiz.map((row) => [row.cohort ?? 'all', row] as const),
    );
    const cohorts: Record<string, GuideBaselineCohortMetrics> = {};
    for (const row of rows) {
      const key = row.cohort ?? 'all';
      const q = quizBy.get(key);
      cohorts[key] = {
        enrollments: Number(row.enrollments ?? 0),
        completionRate: round(row.completionRate),
        medianDaysToComplete: round(row.medianDaysToComplete, 2),
        itemsCompletedPerEnrollment: round(row.itemsCompletedPerEnrollment, 2),
        firstDayWinRate: round(row.firstDayWinRate),
        returnWithin7dRate: round(row.returnWithin7dRate),
        quizFirstAttempts: Number(q?.attempts ?? 0),
        quizFirstAttemptPassRate: round(q?.passRate),
      };
    }
    if (!cohorts.all) {
      cohorts.all = {
        enrollments: 0,
        completionRate: null,
        medianDaysToComplete: null,
        itemsCompletedPerEnrollment: null,
        firstDayWinRate: null,
        returnWithin7dRate: null,
        quizFirstAttempts: 0,
        quizFirstAttemptPassRate: null,
      };
    }
    const metrics: GuideBaselineMetrics = {
      cohorts,
      publicCourses: Number(courses?.[0]?.n ?? 0),
      definitions: DEFINITIONS,
    };
    return this.snapshots.save(
      this.snapshots.create({
        windowDays,
        windowStart,
        windowEnd,
        capturedByUserId: input.userId,
        note: input.note?.slice(0, 500) ?? null,
        metrics,
      }),
    );
  }

  /**
   * Newest first, and always the very first snapshot — the pre-launch
   * baseline every later one is read against — marked `first`, even when
   * it falls outside the page.
   */
  async list(limit = 20) {
    const [page, first] = await Promise.all([
      this.snapshots.find({
        order: { createdAt: 'DESC' },
        take: Math.min(Math.max(limit, 1), 100),
      }),
      this.snapshots.findOne({ where: {}, order: { createdAt: 'ASC' } }),
    ]);
    const rows =
      first && !page.some((row) => row.id === first.id)
        ? [...page, first]
        : page;
    const names = await userNames(
      this.dataSource,
      rows.map((row) => row.capturedByUserId),
    );
    return rows.map((row) => ({
      ...row,
      first: row.id === first?.id,
      capturedByName: row.capturedByUserId
        ? (names.get(row.capturedByUserId) ?? null)
        : null,
    }));
  }
}
