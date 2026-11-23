import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { sessionDurationMsExpr } from '../util/session-eligibility.util';
import { ChartSelection } from '../util/tenant-chart-query.util';

export interface PracticeHeatmap {
  /** Seven rows, Monday first; eight columns of three hours, midnight first. */
  cells: number[][];
  sessions: number;
}

export interface SessionLengths {
  /** Counts per length band, shortest first. */
  bins: number[];
  sessions: number;
  /** Median length in whole minutes. */
  medianMinutes: number | null;
}

export interface ActivationCounts {
  registered: number;
  started: number;
  practisedThreeTimes: number;
  activeRecently: number;
}

export interface RegularityCounts {
  regular: number;
  occasional: number;
  bursty: number;
  /** Weeks in the period, which the shares are measured against. */
  weeks: number;
}

export interface QuizPassRow {
  title: string;
  attempts: number;
  passRatePercent: number;
}

export interface ItemFormatRow {
  type: string;
  reached: number;
  completed: number;
}

export interface SkillChangeRow {
  skill: string;
  first: number;
  latest: number;
  learners: number;
}

/** Upper bounds, in minutes, of the session length bands. The last band is open. */
export const SESSION_LENGTH_BOUNDS_MINUTES = [2, 5, 10, 15, 20, 30];

/**
 * Practice and course-progress aggregates for one tenant, for the Statistics
 * charts that need their own queries. Aggregates only: nothing here returns a
 * name, an email or free text.
 *
 * Several tables store the tenant as a VARCHAR holding either the tenant uuid or
 * its code, and others as a uuid, so every match is `IN ($1, $2)` on `::text`
 * with both spellings. Windows are `[start, endExclusive)`.
 */
@Injectable()
export class TenantPracticeRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Sessions started in the window by weekday and time of day, in the caller's
   * time zone (an IANA name such as `Asia/Kolkata`). An unknown zone makes
   * Postgres refuse the query; the service falls back to UTC.
   */
  async getPracticeHeatmap(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
    timezone: string,
  ): Promise<PracticeHeatmap> {
    const rows: Array<{ dow: number; band: number; n: string }> =
      await this.dataSource.query(
        `SELECT EXTRACT(ISODOW FROM local_at)::int AS dow,
                FLOOR(EXTRACT(HOUR FROM local_at) / 3)::int AS band,
                COUNT(*) AS n
           FROM (
             SELECT (s."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE $5 AS local_at
               FROM scenario_sessions s
              WHERE s.tenant_id::text IN ($1, $2)
                AND s."startedAt" >= $3 AND s."startedAt" < $4
           ) t
          GROUP BY 1, 2`,
        [tenantId, tenantCode, start, endExclusive, timezone],
      );
    const cells = Array.from({ length: 7 }, () => Array(8).fill(0) as number[]);
    rows.forEach((r) => {
      cells[Number(r.dow) - 1][Number(r.band)] = Number(r.n);
    });
    return {
      cells,
      sessions: cells.flat().reduce((a, b) => a + b, 0),
    };
  }

  /** Length of completed sessions, in minutes, from the shared session duration. */
  async getSessionLengths(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
  ): Promise<SessionLengths> {
    // The shared duration (milliseconds, net of paused time) so these lengths
    // agree with Roleplay Logs and the other dashboards.
    const rows: Array<{ minutes: string }> = await this.dataSource.query(
      `SELECT dur / 60000.0 AS minutes
         FROM (
           SELECT ${sessionDurationMsExpr('s', 'd')} AS dur
             FROM scenario_sessions s
             LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
            WHERE s.tenant_id::text IN ($1, $2)
              AND s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND s."startedAt" >= $3 AND s."startedAt" < $4
         ) t
        WHERE dur IS NOT NULL AND dur > 0`,
      [tenantId, tenantCode, start, endExclusive],
    );
    const minutes = rows.map((r) => Number(r.minutes)).sort((a, b) => a - b);
    const bins = Array(SESSION_LENGTH_BOUNDS_MINUTES.length + 1).fill(
      0,
    ) as number[];
    minutes.forEach((m) => {
      const index = SESSION_LENGTH_BOUNDS_MINUTES.findIndex(
        (bound) => m < bound,
      );
      bins[index === -1 ? bins.length - 1 : index] += 1;
    });
    const mid = Math.floor(minutes.length / 2);
    const median =
      minutes.length === 0
        ? null
        : minutes.length % 2
          ? minutes[mid]
          : (minutes[mid - 1] + minutes[mid]) / 2;
    return {
      bins,
      sessions: minutes.length,
      medianMinutes: median === null ? null : Math.round(median),
    };
  }

  /** Where learners get to: registered, started, practised three times, active lately. */
  async getActivationCounts(
    tenantId: string,
    tenantCode: string,
  ): Promise<ActivationCounts> {
    const rows: Array<{
      registered: string;
      started: string;
      three: string;
      recent: string;
    }> = await this.dataSource.query(
      `WITH learners AS (
         SELECT DISTINCT u.id
           FROM users u
           JOIN user_groups ug ON ug."userId" = u.id
           JOIN groups g ON g.id = ug."groupId" AND g.name = 'LEARNER'
          WHERE u.tenant_id::text IN ($1, $2)
       ),
       per AS (
         SELECT l.id,
                COUNT(s.id) AS sessions,
                COUNT(s.id) FILTER (WHERE s."startedAt" > now() - interval '14 days') AS recent
           FROM learners l
           LEFT JOIN scenario_sessions s ON s."counselorId" = l.id
          GROUP BY l.id
       )
       SELECT COUNT(*) AS registered,
              COUNT(*) FILTER (WHERE sessions >= 1) AS started,
              COUNT(*) FILTER (WHERE sessions >= 3) AS three,
              COUNT(*) FILTER (WHERE recent >= 1) AS recent
         FROM per`,
      [tenantId, tenantCode],
    );
    const r = rows[0];
    return {
      registered: Number(r?.registered ?? 0),
      started: Number(r?.started ?? 0),
      practisedThreeTimes: Number(r?.three ?? 0),
      activeRecently: Number(r?.recent ?? 0),
    };
  }

  /**
   * Learners who practised in the window, by how many of the window's weeks they
   * were active in: regular at half the weeks or more, bursty under a fifth.
   */
  async getRegularityCounts(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
  ): Promise<RegularityCounts> {
    const weeks = Math.max(
      1,
      Math.ceil((endExclusive.getTime() - start.getTime()) / (7 * 86_400_000)),
    );
    const rows: Array<{ regular: string; occasional: string; bursty: string }> =
      await this.dataSource.query(
        `WITH active AS (
           SELECT s."counselorId" AS learner,
                  COUNT(DISTINCT date_trunc('week', s."startedAt")) AS weeks_active
             FROM scenario_sessions s
            WHERE s.tenant_id::text IN ($1, $2)
              AND s."startedAt" >= $3 AND s."startedAt" < $4
            GROUP BY s."counselorId"
         )
         SELECT COUNT(*) FILTER (WHERE weeks_active::numeric / $5 >= 0.5) AS regular,
                COUNT(*) FILTER (WHERE weeks_active::numeric / $5 >= 0.2
                                   AND weeks_active::numeric / $5 < 0.5) AS occasional,
                COUNT(*) FILTER (WHERE weeks_active::numeric / $5 < 0.2) AS bursty
           FROM active`,
        [tenantId, tenantCode, start, endExclusive, weeks],
      );
    const r = rows[0];
    return {
      regular: Number(r?.regular ?? 0),
      occasional: Number(r?.occasional ?? 0),
      bursty: Number(r?.bursty ?? 0),
      weeks,
    };
  }

  /** Quizzes with at least `minAttempts` attempts in the window, lowest pass rate first. */
  async getQuizPassRates(
    tenantId: string,
    tenantCode: string,
    start: Date,
    endExclusive: Date,
    minAttempts: number,
    limit: number,
    scope: ChartSelection = {},
  ): Promise<QuizPassRow[]> {
    const params: unknown[] = [
      tenantId,
      tenantCode,
      start,
      endExclusive,
      minAttempts,
      limit,
    ];
    const extra: string[] = [];
    if (scope.courseId !== undefined) {
      params.push(scope.courseId);
      extra.push(`AND i."trackId" = $${params.length}::uuid`);
    }
    if (scope.learnerId !== undefined) {
      params.push(scope.learnerId);
      extra.push(`AND a."userId" = $${params.length}`);
    }
    const rows: Array<{ title: string; attempts: string; passed: string }> =
      await this.dataSource.query(
        `SELECT i.title AS title,
                COUNT(*) AS attempts,
                COUNT(*) FILTER (WHERE a.passed) AS passed
           FROM track_quiz_attempts a
           JOIN users u ON u.id = a."userId"
           JOIN track_items i ON i.id = a."trackItemId"
          WHERE u.tenant_id::text IN ($1, $2)
            AND a."deletedAt" IS NULL
            AND a."createdAt" >= $3 AND a."createdAt" < $4
            ${extra.join('\n            ')}
          GROUP BY i.id, i.title
         HAVING COUNT(*) >= $5
          ORDER BY COUNT(*) FILTER (WHERE a.passed)::numeric / COUNT(*) ASC, COUNT(*) DESC
          LIMIT $6`,
        params,
      );
    return rows.map((r) => ({
      title: r.title,
      attempts: Number(r.attempts),
      passRatePercent: Math.round(
        (Number(r.passed) / Number(r.attempts)) * 100,
      ),
    }));
  }

  /** For each kind of course item, how many learners reached one and how many finished it. */
  async getItemFormatDropoff(
    tenantId: string,
    tenantCode: string,
    scope: ChartSelection = {},
  ): Promise<ItemFormatRow[]> {
    const params: unknown[] = [tenantId, tenantCode];
    const extra: string[] = [];
    if (scope.courseId !== undefined) {
      params.push(scope.courseId);
      extra.push(`AND i."trackId" = $${params.length}::uuid`);
    }
    if (scope.learnerId !== undefined) {
      params.push(scope.learnerId);
      extra.push(`AND p."userId" = $${params.length}`);
    }
    const rows: Array<{ type: string; reached: string; completed: string }> =
      await this.dataSource.query(
        `SELECT i.type AS type,
                COUNT(*) FILTER (WHERE p.status IN ('UNLOCKED', 'COMPLETED')) AS reached,
                COUNT(*) FILTER (WHERE p.status = 'COMPLETED') AS completed
           FROM track_item_progress p
           JOIN track_enrollments e ON e.id = p."trackEnrollmentId"
           JOIN track_items i ON i.id = p."trackItemId"
          WHERE e."tenantId"::text IN ($1, $2)
            AND e."deletedAt" IS NULL AND p."deletedAt" IS NULL
            ${extra.join('\n            ')}
          GROUP BY i.type
         HAVING COUNT(*) FILTER (WHERE p.status IN ('UNLOCKED', 'COMPLETED')) > 0
          ORDER BY COUNT(*) FILTER (WHERE p.status = 'COMPLETED')::numeric
                   / COUNT(*) FILTER (WHERE p.status IN ('UNLOCKED', 'COMPLETED')) ASC`,
        params,
      );
    return rows.map((r) => ({
      type: r.type,
      reached: Number(r.reached),
      completed: Number(r.completed),
    }));
  }

  /**
   * Average skill level on each learner's first and latest scored practice slice,
   * for learners with at least two. Levels are the judge's 1 to 5 rubric levels;
   * a skill the learner had no chance to show (null) is left out.
   */
  async getSkillChange(
    tenantId: string,
    tenantCode: string,
    scope: ChartSelection = {},
  ): Promise<SkillChangeRow[]> {
    const params: unknown[] = [tenantId, tenantCode];
    const extra: string[] = [];
    if (scope.learnerId !== undefined) {
      params.push(scope.learnerId);
      extra.push(`AND c."userId" = $${params.length}`);
    }
    const rows: Array<{
      skill: string;
      first: string;
      latest: string;
      learners: string;
    }> = await this.dataSource.query(
      `WITH levels AS (
         SELECT c."userId" AS learner, c."cutIndex" AS idx, kv.key AS skill, kv.value::numeric AS level
           FROM foundational_skill_cuts c
           JOIN foundational_skill_assessments fa ON fa."cutId" = c.id AND fa.status = 'SCORED'
          CROSS JOIN LATERAL jsonb_each_text(fa."skillLevels") kv
          WHERE c.tenant_id::text IN ($1, $2)
            AND kv.value ~ '^[0-9]+(\\.[0-9]+)?$'
            ${extra.join('\n            ')}
       ),
       ends AS (
         SELECT learner, skill,
                (ARRAY_AGG(level ORDER BY idx ASC))[1] AS first_level,
                (ARRAY_AGG(level ORDER BY idx DESC))[1] AS latest_level
           FROM levels GROUP BY learner, skill HAVING COUNT(*) >= 2
       )
       SELECT skill,
              AVG(first_level) AS first,
              AVG(latest_level) AS latest,
              COUNT(*) AS learners
         FROM ends
        GROUP BY skill
        ORDER BY AVG(latest_level) ASC`,
      params,
    );
    return rows.map((r) => ({
      skill: r.skill,
      first: Math.round(Number(r.first) * 10) / 10,
      latest: Math.round(Number(r.latest) * 10) / 10,
      learners: Number(r.learners),
    }));
  }
}
