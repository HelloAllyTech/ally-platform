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

/** TSQ-042: enrolments started and completed, week by week, since the first one. */
export interface CoursePerformanceData {
  weeks: Array<{ week: string; started: number; completed: number }>;
  enrolled: number;
  completed: number;
}

/** TSQ-045: how many learners reached and finished each module of a course. */
export interface ModuleFunnelData {
  rows: Array<{
    sectionId: string;
    title: string;
    reached: number;
    completed: number;
  }>;
}

/** TSQ-046: the typical elapsed time to finish each module. */
export interface ModuleTimeData {
  rows: Array<{
    sectionId: string;
    title: string;
    medianMinutes: number;
    learners: number;
  }>;
}

/** TSQ-053: for each roleplay in a course, who finished it and how many tries it took. */
export interface RoleplayAttemptsData {
  rows: Array<{
    itemId: string;
    title: string;
    learners: number;
    averageAttempts: number | null;
    averageMinutes: number | null;
  }>;
}

/** TSQ-065: one learner's level in each skill on each scored practice slice. */
export interface SkillTrendData {
  skills: Array<{
    skill: string;
    points: Array<{ slice: number; level: number }>;
  }>;
}

export const FINISH_BOUNDS_DAYS = [1, 3, 7, 14, 30];
const LEARNER_COURSE_LIMIT = 20;
const MODULE_LIMIT = 30;
const SKILL_TREND_SLICES = 12;

/** Learners only, never staff or suspended accounts: the same rule every course card uses. */
const LEARNER_ONLY = `u.status != 'SUSPENDED'
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )`;

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

  /** Who is on a course right now, across the organisation. */
  async getCourseParticipation(
    tenantId: string,
    tenantCode: string,
  ): Promise<MeasuresData> {
    const rows: Array<{
      learners: string;
      in_progress: string;
      not_started: string;
      finished: string;
    }> = await this.dataSource.query(
      `SELECT COUNT(DISTINCT e."userId") AS learners,
              COUNT(DISTINCT e."userId") FILTER (
                WHERE e."completedAt" IS NULL AND (e."startedAt" IS NOT NULL OR e."completedItems" > 0)
              ) AS in_progress,
              COUNT(DISTINCT e."userId") FILTER (
                WHERE e."completedAt" IS NULL AND e."startedAt" IS NULL AND e."completedItems" = 0
              ) AS not_started,
              COUNT(DISTINCT e."userId") FILTER (WHERE e."completedAt" IS NOT NULL) AS finished
         FROM track_enrollments e
         JOIN users u ON u.id = e."userId"
        WHERE e."tenantId"::text IN ($1, $2)
          AND e."deletedAt" IS NULL
          AND ${LEARNER_ONLY}`,
      [tenantId, tenantCode],
    );
    const r = rows[0];
    return {
      measures: [
        {
          key: 'learnersOnCourses',
          value: Number(r?.learners ?? 0),
          format: 'count',
        },
        {
          key: 'inProgress',
          value: Number(r?.in_progress ?? 0),
          format: 'count',
        },
        {
          key: 'notStarted',
          value: Number(r?.not_started ?? 0),
          format: 'count',
        },
        {
          key: 'finishedACourse',
          value: Number(r?.finished ?? 0),
          format: 'count',
        },
      ],
    };
  }

  /** Enrolments begun and finished each week since the first one, for every course or one. */
  async getCoursePerformance(
    tenantId: string,
    tenantCode: string,
    courseId?: string,
  ): Promise<CoursePerformanceData> {
    const params: unknown[] = [tenantId, tenantCode];
    let course = '';
    if (courseId) {
      params.push(courseId);
      course = `AND e."trackId" = $${params.length}::uuid`;
    }
    const rows: Array<{ week: Date; started: string; completed: string }> =
      await this.dataSource.query(
        `WITH events AS (
           SELECT date_trunc('week', COALESCE(e."startedAt", e."createdAt")) AS week,
                  1 AS started, 0 AS completed
             FROM track_enrollments e JOIN users u ON u.id = e."userId"
            WHERE e."tenantId"::text IN ($1, $2) AND e."deletedAt" IS NULL
              AND ${LEARNER_ONLY} ${course}
           UNION ALL
           SELECT date_trunc('week', e."completedAt"), 0, 1
             FROM track_enrollments e JOIN users u ON u.id = e."userId"
            WHERE e."tenantId"::text IN ($1, $2) AND e."deletedAt" IS NULL
              AND e."completedAt" IS NOT NULL
              AND ${LEARNER_ONLY} ${course}
         )
         SELECT week, SUM(started) AS started, SUM(completed) AS completed
           FROM events GROUP BY week ORDER BY week`,
        params,
      );
    const weeks = rows.map((r) => ({
      week: new Date(r.week).toISOString().slice(0, 10),
      started: Number(r.started),
      completed: Number(r.completed),
    }));
    return {
      weeks,
      enrolled: weeks.reduce((n, w) => n + w.started, 0),
      completed: weeks.reduce((n, w) => n + w.completed, 0),
    };
  }

  /** For each module of one course in order: learners who reached it and who finished all of it. */
  async getModuleFunnel(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<ModuleFunnelData> {
    const rows: Array<{
      section_id: string;
      title: string;
      reached: string;
      completed: string;
    }> = await this.dataSource.query(
      `WITH per AS (
         SELECT s.id AS section_id, s.title, s."order" AS ord, e.id AS enrolment,
                COUNT(*) FILTER (WHERE p.status IN ('UNLOCKED', 'COMPLETED')) AS reached_items,
                COUNT(*) FILTER (WHERE p.status = 'COMPLETED') AS done_items,
                (SELECT COUNT(*) FROM track_items i2
                  WHERE i2."trackSectionId" = s.id AND i2."deletedAt" IS NULL) AS total_items
           FROM track_sections s
           JOIN track_items i ON i."trackSectionId" = s.id AND i."deletedAt" IS NULL
           JOIN track_item_progress p ON p."trackItemId" = i.id AND p."deletedAt" IS NULL
           JOIN track_enrollments e ON e.id = p."trackEnrollmentId" AND e."deletedAt" IS NULL
           JOIN users u ON u.id = e."userId"
          WHERE s."trackId" = $3::uuid AND s."deletedAt" IS NULL
            AND e."tenantId"::text IN ($1, $2)
            AND ${LEARNER_ONLY}
          GROUP BY s.id, s.title, s."order", e.id
       )
       SELECT section_id::text, title,
              COUNT(*) FILTER (WHERE reached_items > 0) AS reached,
              COUNT(*) FILTER (WHERE total_items > 0 AND done_items >= total_items) AS completed
         FROM per GROUP BY section_id, title, ord
        ORDER BY ord
        LIMIT ${MODULE_LIMIT}`,
      [tenantId, tenantCode, courseId],
    );
    return {
      rows: rows.map((r) => ({
        sectionId: r.section_id,
        title: r.title,
        reached: Number(r.reached),
        completed: Number(r.completed),
      })),
    };
  }

  /** The typical time from first start to last finish in each module, for those who finished it. */
  async getModuleTime(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<ModuleTimeData> {
    const rows: Array<{
      section_id: string;
      title: string;
      median_minutes: string;
      learners: string;
    }> = await this.dataSource.query(
      `WITH per AS (
         SELECT s.id AS section_id, s.title, s."order" AS ord, e.id AS enrolment,
                EXTRACT(EPOCH FROM (MAX(p."completedAt") - MIN(p."startedAt"))) / 60.0 AS minutes,
                COUNT(*) FILTER (WHERE p.status = 'COMPLETED') AS done_items,
                (SELECT COUNT(*) FROM track_items i2
                  WHERE i2."trackSectionId" = s.id AND i2."deletedAt" IS NULL) AS total_items
           FROM track_sections s
           JOIN track_items i ON i."trackSectionId" = s.id AND i."deletedAt" IS NULL
           JOIN track_item_progress p ON p."trackItemId" = i.id AND p."deletedAt" IS NULL
           JOIN track_enrollments e ON e.id = p."trackEnrollmentId" AND e."deletedAt" IS NULL
           JOIN users u ON u.id = e."userId"
          WHERE s."trackId" = $3::uuid AND s."deletedAt" IS NULL
            AND e."tenantId"::text IN ($1, $2)
            AND ${LEARNER_ONLY}
          GROUP BY s.id, s.title, s."order", e.id
       )
       SELECT section_id::text, title,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median_minutes,
              COUNT(*) AS learners
         FROM per
        WHERE total_items > 0 AND done_items >= total_items AND minutes IS NOT NULL AND minutes >= 0
        GROUP BY section_id, title, ord
        ORDER BY ord
        LIMIT ${MODULE_LIMIT}`,
      [tenantId, tenantCode, courseId],
    );
    return {
      rows: rows.map((r) => ({
        sectionId: r.section_id,
        title: r.title,
        medianMinutes: Math.round(Number(r.median_minutes)),
        learners: Number(r.learners),
      })),
    };
  }

  /** Each roleplay in one course: who finished it, tries it took, and how long a session ran. */
  async getRoleplayAttempts(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<RoleplayAttemptsData> {
    const rows: Array<{
      item_id: string;
      title: string;
      learners: string;
      avg_attempts: string | null;
      avg_minutes: string | null;
    }> = await this.dataSource.query(
      `SELECT i.id::text AS item_id, i.title,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'COMPLETED') AS learners,
              AVG(p."attemptCount") FILTER (WHERE p.status = 'COMPLETED' AND p."attemptCount" > 0) AS avg_attempts,
              AVG(${sessionDurationMsExpr('s', 'd')}) / 60000.0 AS avg_minutes
         FROM track_items i
         JOIN track_item_progress p ON p."trackItemId" = i.id AND p."deletedAt" IS NULL
         JOIN track_enrollments e ON e.id = p."trackEnrollmentId" AND e."deletedAt" IS NULL
         JOIN users u ON u.id = e."userId"
         LEFT JOIN scenario_sessions s ON s."trackItemProgressId" = p.id
                                      AND s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
         LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        WHERE i."trackId" = $3::uuid AND i.type = 'ROLEPLAY' AND i."deletedAt" IS NULL
          AND e."tenantId"::text IN ($1, $2)
          AND ${LEARNER_ONLY}
        GROUP BY i.id, i.title, i."order"
        ORDER BY i."order"
        LIMIT ${MODULE_LIMIT}`,
      [tenantId, tenantCode, courseId],
    );
    return {
      rows: rows.map((r) => ({
        itemId: r.item_id,
        title: r.title,
        learners: Number(r.learners),
        averageAttempts:
          r.avg_attempts == null
            ? null
            : Math.round(Number(r.avg_attempts) * 10) / 10,
        averageMinutes:
          r.avg_minutes == null ? null : Math.round(Number(r.avg_minutes)),
      })),
    };
  }

  /** A learner's level in each skill over their scored practice slices, oldest first. */
  async getSkillTrend(
    tenantId: string,
    tenantCode: string,
    learnerId: number,
  ): Promise<SkillTrendData> {
    const rows: Array<{ skill: string; idx: number; level: string }> =
      await this.dataSource.query(
        `SELECT kv.key AS skill, c."cutIndex" AS idx, kv.value::numeric AS level
           FROM foundational_skill_cuts c
           JOIN foundational_skill_assessments fa ON fa."cutId" = c.id AND fa.status = 'SCORED'
          CROSS JOIN LATERAL jsonb_each_text(fa."skillLevels") kv
          WHERE c.tenant_id::text IN ($1, $2)
            AND c."userId" = $3
            AND kv.value ~ '^[0-9]+(\\.[0-9]+)?$'
          ORDER BY c."cutIndex" ASC`,
        [tenantId, tenantCode, learnerId],
      );
    const bySkill = new Map<string, Array<{ slice: number; level: number }>>();
    rows.forEach((r) => {
      const list = bySkill.get(r.skill) ?? [];
      list.push({ slice: Number(r.idx), level: Number(r.level) });
      bySkill.set(r.skill, list);
    });
    return {
      skills: [...bySkill.entries()]
        .map(([skill, points]) => ({
          skill,
          points: points.slice(-SKILL_TREND_SLICES),
        }))
        .filter((s) => s.points.length >= 2),
    };
  }
}
