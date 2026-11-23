import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { sessionDurationMsExpr } from '../util/session-eligibility.util';

/** One number on a facts card. `format` tells the page how to write it. */
export interface MeasureRow {
  key: string;
  value: number | null;
  format: 'count' | 'days' | 'minutes' | 'score' | 'percent' | 'date';
  /** For a `date`: ISO date text; `value` is then null. */
  text?: string | null;
}

export interface MeasuresData {
  measures: MeasureRow[];
}

export interface TimeToFinishData {
  /** Counts per band; `boundsDays` are the upper limits of every band but the last. */
  bins: number[];
  boundsDays: number[];
  completed: number;
  medianDays: number | null;
}

export interface LearnerCourseRow {
  courseId: string;
  title: string;
  completedItems: number;
  totalItems: number;
  /** `completed` when finished, `inProgress` when started, otherwise `notStarted`. */
  status: 'completed' | 'inProgress' | 'notStarted';
  lastActivityAt: string | null;
}

export const FINISH_BOUNDS_DAYS = [1, 3, 7, 14, 30];
const LEARNER_COURSE_LIMIT = 20;

/**
 * Facts about one course or one learner, for the cards that are about a single
 * thing rather than a ranking. Every statement is tenant-scoped (both id
 * spellings) and returns numbers and course titles only: no free text.
 * The caller has already checked the course or learner belongs to the tenant.
 */
@Injectable()
export class TenantScopeSummaryRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Who has taken one course: enrolled, started, completed, and the typical time to finish. */
  async getCourseFacts(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<MeasuresData> {
    const rows: Array<{
      enrolled: string;
      started: string;
      completed: string;
      total_items: number | null;
      median_days: string | null;
    }> = await this.dataSource.query(
      `SELECT COUNT(*) AS enrolled,
              COUNT(*) FILTER (WHERE e."startedAt" IS NOT NULL OR e."completedItems" > 0) AS started,
              COUNT(*) FILTER (WHERE e."completedAt" IS NOT NULL) AS completed,
              (SELECT t."totalItems" FROM tracks t WHERE t.id = $3::uuid) AS total_items,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (e."completedAt" - e."startedAt")) / 86400.0
              ) FILTER (WHERE e."completedAt" IS NOT NULL AND e."startedAt" IS NOT NULL) AS median_days
         FROM track_enrollments e
         JOIN users u ON u.id = e."userId"
        WHERE e."trackId" = $3::uuid
          AND e."tenantId"::text IN ($1, $2)
          AND e."deletedAt" IS NULL
          AND u.status != 'SUSPENDED'
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )`,
      [tenantId, tenantCode, courseId],
    );
    const r = rows[0];
    const enrolled = Number(r?.enrolled ?? 0);
    const completed = Number(r?.completed ?? 0);
    return {
      measures: [
        { key: 'items', value: r?.total_items ?? null, format: 'count' },
        { key: 'enrolled', value: enrolled, format: 'count' },
        { key: 'started', value: Number(r?.started ?? 0), format: 'count' },
        { key: 'completed', value: completed, format: 'count' },
        {
          key: 'completionRate',
          value: enrolled > 0 ? Math.round((completed / enrolled) * 100) : null,
          format: 'percent',
        },
        {
          key: 'medianDays',
          value:
            r?.median_days == null
              ? null
              : Math.round(Number(r.median_days) * 10) / 10,
          format: 'days',
        },
      ],
    };
  }

  /** How many days learners took to finish one course, in bands, with the median. */
  async getTimeToFinish(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<TimeToFinishData> {
    const rows: Array<{ days: string }> = await this.dataSource.query(
      `SELECT EXTRACT(EPOCH FROM (e."completedAt" - e."startedAt")) / 86400.0 AS days
         FROM track_enrollments e
         JOIN users u ON u.id = e."userId"
        WHERE e."trackId" = $3::uuid
          AND e."tenantId"::text IN ($1, $2)
          AND e."deletedAt" IS NULL
          AND u.status != 'SUSPENDED'
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )
          AND e."completedAt" IS NOT NULL AND e."startedAt" IS NOT NULL`,
      [tenantId, tenantCode, courseId],
    );
    const days = rows.map((r) => Number(r.days)).sort((a, b) => a - b);
    const bins = Array.from({ length: FINISH_BOUNDS_DAYS.length + 1 }, () => 0);
    days.forEach((d) => {
      const i = FINISH_BOUNDS_DAYS.findIndex((bound) => d < bound);
      bins[i === -1 ? FINISH_BOUNDS_DAYS.length : i] += 1;
    });
    const mid = Math.floor(days.length / 2);
    const median =
      days.length === 0
        ? null
        : days.length % 2
          ? days[mid]
          : (days[mid - 1] + days[mid]) / 2;
    return {
      bins,
      boundsDays: FINISH_BOUNDS_DAYS,
      completed: days.length,
      medianDays: median === null ? null : Math.round(median * 10) / 10,
    };
  }

  /** One learner's practice in the window: sessions, score, time, active weeks, last practice. */
  async getPracticeRhythm(
    tenantId: string,
    tenantCode: string,
    learnerId: number,
    start: Date,
    endExclusive: Date,
  ): Promise<MeasuresData> {
    const rows: Array<{
      completed: string;
      avg_score: string | null;
      minutes: string | null;
      active_weeks: string;
      last_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED') AS completed,
              AVG(d."compositeScore") AS avg_score,
              SUM(${sessionDurationMsExpr('s', 'd')}) / 60000.0 AS minutes,
              COUNT(DISTINCT date_trunc('week', s."startedAt")) AS active_weeks,
              MAX(s."startedAt") AS last_at
         FROM scenario_sessions s
         LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        WHERE s.tenant_id::text IN ($1, $2)
          AND s."counselorId" = $3
          AND s."startedAt" >= $4 AND s."startedAt" < $5`,
      [tenantId, tenantCode, learnerId, start, endExclusive],
    );
    const r = rows[0];
    return {
      measures: [
        { key: 'sessions', value: Number(r?.completed ?? 0), format: 'count' },
        {
          key: 'averageScore',
          value: r?.avg_score == null ? null : Math.round(Number(r.avg_score)),
          format: 'score',
        },
        {
          key: 'minutes',
          value: r?.minutes == null ? null : Math.round(Number(r.minutes)),
          format: 'minutes',
        },
        {
          key: 'activeWeeks',
          value: Number(r?.active_weeks ?? 0),
          format: 'count',
        },
        {
          key: 'lastPracticed',
          value: null,
          format: 'date',
          text: r?.last_at ? new Date(r.last_at).toISOString() : null,
        },
      ],
    };
  }

  /** Where one learner is in each of their courses. */
  async getLearnerCourses(
    tenantId: string,
    tenantCode: string,
    learnerId: number,
  ): Promise<LearnerCourseRow[]> {
    const rows: Array<{
      course_id: string;
      title: string;
      completed_items: number;
      total_items: number;
      completed_at: Date | null;
      started_at: Date | null;
      last_activity_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT t.id::text AS course_id, t.title AS title,
              e."completedItems" AS completed_items, t."totalItems" AS total_items,
              e."completedAt" AS completed_at, e."startedAt" AS started_at,
              e."lastActivityAt" AS last_activity_at
         FROM track_enrollments e
         JOIN tracks t ON t.id = e."trackId" AND t."deletedAt" IS NULL
        WHERE e."userId" = $3
          AND e."tenantId"::text IN ($1, $2)
          AND e."deletedAt" IS NULL
        ORDER BY e."lastActivityAt" DESC NULLS LAST, t.title
        LIMIT ${LEARNER_COURSE_LIMIT}`,
      [tenantId, tenantCode, learnerId],
    );
    return rows.map((r) => ({
      courseId: r.course_id,
      title: r.title,
      completedItems: Number(r.completed_items ?? 0),
      totalItems: Number(r.total_items ?? 0),
      status: r.completed_at
        ? 'completed'
        : r.started_at || Number(r.completed_items) > 0
          ? 'inProgress'
          : 'notStarted',
      lastActivityAt: r.last_activity_at
        ? new Date(r.last_activity_at).toISOString()
        : null,
    }));
  }
}
