import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { inModuleOrder } from '../util/module-order.util';
import type { MeasureRow } from './tenant-scope-summary.repository';

/** A cell needs this many learners behind it before it is drawn. */
export const DEPTH_MIN_LEARNERS = 3;
/** A roleplay needs this many sessions before its spread is drawn. */
export const SPREAD_MIN_SESSIONS = 5;
/** A learner's score must move this many points (of 100) to count as up or down. */
export const CHANGE_THRESHOLD_POINTS = 5;
const MODULE_LIMIT = 30;
const LEARNER_ROWS = 25;
const CHANGE_ROWS_EACH_END = 12;
const WAITING_ROWS = 10;
const COHORT_ROWS = 12;
const COURSE_GRID_ROWS = 12;
const BEHAVIOUR_ROWS = 8;

/** Learners only, never staff or suspended accounts: the same rule every course card uses. */
const LEARNER_ONLY = `u.status != 'SUSPENDED'
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )`;
const COMPLETED_SESSION = `ss.status = 'ENDED' AND ss."eventStatus" = 'COMPLETED'`;
const DIFFICULTY_RANK = `CASE sc."difficultyLevel" WHEN 'HARD' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'EASY' THEN 1 END`;

export type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTY_BY_RANK: Record<number, Difficulty> = {
  1: 'easy',
  2: 'medium',
  3: 'hard',
};

export interface LearnersAcrossModulesData {
  modules: Array<{ sectionId: string; title: string }>;
  learners: Array<{
    learnerId: number;
    name: string;
    cells: Array<{
      status: 'completed' | 'inProgress' | 'notStarted';
      /** Minutes from first start to last finish in the module; only for a finished one. */
      minutes: number | null;
    }>;
  }>;
  /** True when the course has more learners than were listed. */
  truncated: boolean;
}

export interface ModuleDifficultyData {
  /** Easiest first; a module with no tagged roleplay has no difficulty and comes last. */
  modules: Array<{
    sectionId: string;
    title: string;
    difficulty: Difficulty | null;
    reached: number;
    completionPercent: number | null;
    averageScore: number | null;
    averageAttempts: number | null;
  }>;
  levels: Array<{
    difficulty: Difficulty;
    modules: number;
    reached: number;
    completionPercent: number | null;
    averageScore: number | null;
    medianMinutes: number | null;
  }>;
}

export interface RoleplayTableData {
  rows: Array<{
    itemId: string;
    title: string;
    sessions: number;
    abandonmentPercent: number | null;
    averageScore: number | null;
    averageRating: number | null;
    ratings: number;
  }>;
}

export interface ScoreSpreadData {
  rows: Array<{
    itemId: string;
    title: string;
    sessions: number;
    low: number;
    typical: number;
    high: number;
  }>;
}

export interface LearnerChangeData {
  counts: { improving: number; steady: number; declining: number };
  rows: Array<{
    learnerId: number;
    name: string;
    first: number;
    latest: number;
    change: number;
    trend: 'improving' | 'steady' | 'declining';
  }>;
}

export interface SkillGridData {
  rows: Array<{ id: string; title: string }>;
  skills: string[];
  /** Average skill level (1 to 4) where at least {@link DEPTH_MIN_LEARNERS} learners are behind it. */
  cells: Array<{
    rowId: string;
    skill: string;
    level: number;
    learners: number;
  }>;
}

export interface BehavioursAgainstGroupData {
  /** Scored practice slices behind the learner's shares and behind the group's. */
  learnerSlices: number;
  groupSlices: number;
  rows: Array<{
    code: string;
    skill: string;
    text: string;
    learnerPercent: number;
    groupPercent: number;
  }>;
}

export interface SessionsWaitingData {
  total: number;
  rows: Array<{
    sessionId: string;
    scenarioTitle: string;
    learnerName: string;
    completedAt: string;
    daysWaiting: number;
  }>;
}

export interface CohortsData {
  rows: Array<{
    /** First day of the month the cohort started, `yyyy-mm-dd`. */
    start: string;
    size: number;
    completedPercent: number;
    averageScore: number | null;
  }>;
}

export interface MeasuresResult {
  measures: MeasureRow[];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const num = (v: unknown): number => Number(v) || 0;
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

const behaviourInfo = new Map(
  FHS_RUBRIC.flatMap((skill) =>
    [...skill.basic, ...skill.advanced].map((b) => [
      b.code,
      { skill: skill.name, text: b.text },
    ]),
  ),
);

/**
 * The queries behind the course and learner depth charts on Statistics: who
 * reached which module and how long it took, how hard the modules are, how each
 * roleplay is going, and how each learner has changed.
 *
 * Aggregates, plus a learner's name where the chart is about learners (the
 * organisation's admin sees these learners on the learner table already). Never
 * free text a learner said. Several tables store the tenant as a VARCHAR holding
 * the tenant uuid or its code, so both are matched.
 */
@Injectable()
export class TenantDepthRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Every learner on a course against every module: where they are and how long it took. */
  async getLearnersAcrossModules(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<LearnersAcrossModulesData> {
    const rows: Array<{
      uid: number;
      name: string | null;
      last_at: Date | null;
      section_id: string;
      title: string;
      ord: number;
      total: string;
      done: string;
      started: string;
      minutes: string | null;
    }> = await this.dataSource.query(
      `SELECT e."userId" AS uid, u.name, e."lastActivityAt" AS last_at,
              s.id::text AS section_id, s.title, s."order" AS ord,
              COUNT(i.id) AS total,
              COUNT(p.id) FILTER (WHERE p.status = 'COMPLETED') AS done,
              COUNT(p.id) FILTER (WHERE p.status IN ('IN_PROGRESS', 'COMPLETED')) AS started,
              EXTRACT(EPOCH FROM (MAX(p."completedAt") - MIN(p."startedAt"))) / 60.0 AS minutes
         FROM track_enrollments e
         JOIN users u ON u.id = e."userId"
         JOIN track_sections s ON s."trackId" = e."trackId" AND s."deletedAt" IS NULL
         JOIN track_items i ON i."trackSectionId" = s.id AND i."deletedAt" IS NULL
         LEFT JOIN track_item_progress p ON p."trackItemId" = i.id
                                        AND p."trackEnrollmentId" = e.id
                                        AND p."deletedAt" IS NULL
        WHERE e."trackId" = $3::uuid AND e."deletedAt" IS NULL
          AND e."tenantId"::text IN ($1, $2)
          AND ${LEARNER_ONLY}
        GROUP BY e."userId", u.name, e."lastActivityAt", s.id, s.title, s."order"
        ORDER BY s."order"`,
      [tenantId, tenantCode, courseId],
    );

    const modules: LearnersAcrossModulesData['modules'] = [];
    const byLearner = new Map<
      number,
      {
        name: string;
        last: number;
        cells: Map<
          string,
          LearnersAcrossModulesData['learners'][number]['cells'][number]
        >;
      }
    >();
    rows.forEach((r) => {
      if (!modules.some((m) => m.sectionId === r.section_id)) {
        modules.push({ sectionId: r.section_id, title: r.title });
      }
      const entry = byLearner.get(r.uid) ?? {
        name: r.name ?? '',
        last: r.last_at ? new Date(r.last_at).getTime() : 0,
        cells: new Map(),
      };
      const total = num(r.total);
      const done = num(r.done);
      const status =
        total > 0 && done >= total
          ? 'completed'
          : num(r.started) > 0
            ? 'inProgress'
            : 'notStarted';
      entry.cells.set(r.section_id, {
        status,
        minutes:
          status === 'completed' && r.minutes !== null && Number(r.minutes) >= 0
            ? Math.round(Number(r.minutes))
            : null,
      });
      byLearner.set(r.uid, entry);
    });
    const moduleList = inModuleOrder(modules);
    const ordered = [...byLearner.entries()].sort(
      (a, b) => b[1].last - a[1].last,
    );
    return {
      modules: moduleList.slice(0, MODULE_LIMIT),
      learners: ordered.slice(0, LEARNER_ROWS).map(([learnerId, l]) => ({
        learnerId,
        name: l.name,
        cells: moduleList.slice(0, MODULE_LIMIT).map(
          (m) =>
            l.cells.get(m.sectionId) ?? {
              status: 'notStarted',
              minutes: null,
            },
        ),
      })),
      truncated: ordered.length > LEARNER_ROWS,
    };
  }

  /**
   * Modules ranked easiest to hardest, and how learners fare at each level.
   * A module's difficulty is the hardest difficulty tag among the roleplays it
   * holds (the tag is on the scenario, not on the module).
   */
  async getModuleDifficulty(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<ModuleDifficultyData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `WITH mods AS (
         SELECT s.id AS section_id, s.title, s."order" AS ord,
                MAX(${DIFFICULTY_RANK}) AS diff
           FROM track_sections s
           JOIN track_items i ON i."trackSectionId" = s.id AND i."deletedAt" IS NULL
           LEFT JOIN scenarios sc ON sc.id = i."scenarioId"
          WHERE s."trackId" = $3::uuid AND s."deletedAt" IS NULL
          GROUP BY s.id, s.title, s."order"
       ),
       per AS (
         SELECT s.id AS section_id, e.id AS enrolment,
                COUNT(i.id) AS total,
                COUNT(p.id) FILTER (WHERE p.status = 'COMPLETED') AS done,
                COUNT(p.id) FILTER (WHERE p.status IN ('IN_PROGRESS', 'COMPLETED')) AS started,
                EXTRACT(EPOCH FROM (MAX(p."completedAt") - MIN(p."startedAt"))) / 60.0 AS minutes,
                AVG(p."attemptCount") FILTER (WHERE p."attemptCount" > 0) AS attempts
           FROM track_sections s
           JOIN track_items i ON i."trackSectionId" = s.id AND i."deletedAt" IS NULL
           JOIN track_enrollments e ON e."trackId" = s."trackId" AND e."deletedAt" IS NULL
           JOIN users u ON u.id = e."userId"
           LEFT JOIN track_item_progress p ON p."trackItemId" = i.id
                                          AND p."trackEnrollmentId" = e.id
                                          AND p."deletedAt" IS NULL
          WHERE s."trackId" = $3::uuid AND s."deletedAt" IS NULL
            AND e."tenantId"::text IN ($1, $2)
            AND ${LEARNER_ONLY}
          GROUP BY s.id, e.id
       ),
       scores AS (
         SELECT i."trackSectionId" AS section_id, AVG(d."compositeScore") AS avg_score
           FROM track_items i
           JOIN track_item_progress p ON p."trackItemId" = i.id AND p."deletedAt" IS NULL
           JOIN scenario_sessions ss ON ss."trackItemProgressId" = p.id AND ${COMPLETED_SESSION}
           JOIN scenario_session_details d ON d."scenarioSessionId" = ss.id
          WHERE i."trackId" = $3::uuid AND i."deletedAt" IS NULL
            AND ss.tenant_id::text IN ($1, $2)
            AND d."compositeScore" IS NOT NULL
          GROUP BY i."trackSectionId"
       )
       SELECT m.section_id::text AS section_id, m.title, m.diff,
              COUNT(per.enrolment) FILTER (WHERE per.started > 0) AS reached,
              COUNT(per.enrolment) FILTER (WHERE per.total > 0 AND per.done >= per.total) AS completed,
              AVG(per.attempts) AS attempts,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY per.minutes)
                FILTER (WHERE per.total > 0 AND per.done >= per.total AND per.minutes >= 0) AS median_minutes,
              sc.avg_score
         FROM mods m
         LEFT JOIN per ON per.section_id = m.section_id
         LEFT JOIN scores sc ON sc.section_id = m.section_id
        GROUP BY m.section_id, m.title, m.ord, m.diff, sc.avg_score
        ORDER BY m.ord
        LIMIT ${MODULE_LIMIT}`,
      [tenantId, tenantCode, courseId],
    );

    const modules = rows.map((r) => {
      const reached = num(r.reached);
      return {
        sectionId: String(r.section_id),
        title: String(r.title),
        difficulty: DIFFICULTY_BY_RANK[num(r.diff)] ?? null,
        reached,
        completionPercent:
          reached > 0 ? Math.round((num(r.completed) / reached) * 100) : null,
        averageScore:
          r.avg_score === null ? null : Math.round(Number(r.avg_score)),
        averageAttempts:
          r.attempts === null ? null : round1(Number(r.attempts)),
        medianMinutes: numOrNull(r.median_minutes),
        completed: num(r.completed),
      };
    });
    const rank = (d: Difficulty | null) =>
      d === 'easy' ? 1 : d === 'medium' ? 2 : d === 'hard' ? 3 : 4;
    const ranked = [...inModuleOrder(modules)].sort(
      (a, b) => rank(a.difficulty) - rank(b.difficulty),
    );

    const levels = (['easy', 'medium', 'hard'] as const)
      .map((difficulty) => {
        const mods = modules.filter((m) => m.difficulty === difficulty);
        if (mods.length === 0) return null;
        const reached = mods.reduce((s, m) => s + m.reached, 0);
        const completed = mods.reduce((s, m) => s + m.completed, 0);
        const scores = mods
          .map((m) => m.averageScore)
          .filter((v): v is number => v !== null);
        const minutes = mods
          .map((m) => m.medianMinutes)
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b);
        return {
          difficulty,
          modules: mods.length,
          reached,
          completionPercent:
            reached > 0 ? Math.round((completed / reached) * 100) : null,
          averageScore: scores.length
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : null,
          medianMinutes: minutes.length
            ? Math.round(minutes[Math.floor((minutes.length - 1) / 2)])
            : null,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    return {
      modules: ranked.map((m) => ({
        sectionId: m.sectionId,
        title: m.title,
        difficulty: m.difficulty,
        reached: m.reached,
        completionPercent: m.completionPercent,
        averageScore: m.averageScore,
        averageAttempts: m.averageAttempts,
      })),
      levels,
    };
  }

  /** Each roleplay of a course: sessions, how many were left unfinished, score and rating. */
  async getRoleplayTable(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<RoleplayTableData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT i.id::text AS item_id, COALESCE(sc.title, i.title) AS title,
              COUNT(DISTINCT ss.id) AS sessions,
              COUNT(DISTINCT ss.id) FILTER (WHERE ${COMPLETED_SESSION}) AS completed,
              AVG(d."compositeScore") FILTER (WHERE ${COMPLETED_SESSION}) AS avg_score,
              AVG(f.rating) FILTER (WHERE f.rating BETWEEN 1 AND 5) AS avg_rating,
              COUNT(f.id) FILTER (WHERE f.rating BETWEEN 1 AND 5) AS ratings
         FROM track_items i
         LEFT JOIN scenarios sc ON sc.id = i."scenarioId"
         JOIN track_item_progress p ON p."trackItemId" = i.id AND p."deletedAt" IS NULL
         JOIN track_enrollments e ON e.id = p."trackEnrollmentId" AND e."deletedAt" IS NULL
         JOIN users u ON u.id = e."userId"
         JOIN scenario_sessions ss ON ss."trackItemProgressId" = p.id
         LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = ss.id
         LEFT JOIN scenario_session_feedbacks f ON f."scenarioSessionId" = ss.id
        WHERE i."trackId" = $3::uuid AND i.type = 'ROLEPLAY' AND i."deletedAt" IS NULL
          AND e."tenantId"::text IN ($1, $2)
          AND ${LEARNER_ONLY}
        GROUP BY i.id, i.title, i."order", sc.title
        ORDER BY i."order"
        LIMIT ${MODULE_LIMIT}`,
      [tenantId, tenantCode, courseId],
    );
    return {
      rows: rows.map((r) => {
        const sessions = num(r.sessions);
        return {
          itemId: String(r.item_id),
          title: String(r.title),
          sessions,
          abandonmentPercent:
            sessions > 0
              ? Math.round(((sessions - num(r.completed)) / sessions) * 100)
              : null,
          averageScore:
            r.avg_score === null ? null : Math.round(Number(r.avg_score)),
          averageRating:
            r.avg_rating === null ? null : round1(Number(r.avg_rating)),
          ratings: num(r.ratings),
        };
      }),
    };
  }

  /** The low, typical and high session score of each roleplay of a course (10th, 50th and 90th percentile). */
  async getScoreSpread(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<ScoreSpreadData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT i.id::text AS item_id, COALESCE(sc.title, i.title) AS title,
              COUNT(*) AS sessions,
              percentile_cont(0.1) WITHIN GROUP (ORDER BY d."compositeScore") AS low,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY d."compositeScore") AS typical,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY d."compositeScore") AS high
         FROM track_items i
         LEFT JOIN scenarios sc ON sc.id = i."scenarioId"
         JOIN track_item_progress p ON p."trackItemId" = i.id AND p."deletedAt" IS NULL
         JOIN track_enrollments e ON e.id = p."trackEnrollmentId" AND e."deletedAt" IS NULL
         JOIN users u ON u.id = e."userId"
         JOIN scenario_sessions ss ON ss."trackItemProgressId" = p.id AND ${COMPLETED_SESSION}
         JOIN scenario_session_details d ON d."scenarioSessionId" = ss.id
        WHERE i."trackId" = $3::uuid AND i.type = 'ROLEPLAY' AND i."deletedAt" IS NULL
          AND e."tenantId"::text IN ($1, $2)
          AND d."compositeScore" IS NOT NULL
          AND ${LEARNER_ONLY}
        GROUP BY i.id, i.title, i."order", sc.title
        HAVING COUNT(*) >= ${SPREAD_MIN_SESSIONS}
        ORDER BY i."order"
        LIMIT ${MODULE_LIMIT}`,
      [tenantId, tenantCode, courseId],
    );
    return {
      rows: rows.map((r) => ({
        itemId: String(r.item_id),
        title: String(r.title),
        sessions: num(r.sessions),
        low: Math.round(Number(r.low)),
        typical: Math.round(Number(r.typical)),
        high: Math.round(Number(r.high)),
      })),
    };
  }

  /** Each learner's first and latest session score, tagged improving, steady or declining. */
  async getLearnerChange(
    tenantId: string,
    tenantCode: string,
    courseId?: string,
  ): Promise<LearnerChangeData> {
    const params: unknown[] = [tenantId, tenantCode];
    if (courseId) params.push(courseId);
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `WITH scored AS (
         SELECT ss."counselorId" AS uid, d."compositeScore" AS score, ss."startedAt" AS at
           FROM scenario_sessions ss
           JOIN scenario_session_details d ON d."scenarioSessionId" = ss.id
           ${
             courseId
               ? `JOIN track_item_progress p ON p.id = ss."trackItemProgressId"
           JOIN track_items i ON i.id = p."trackItemId" AND i."trackId" = $3::uuid`
               : ''
           }
          WHERE ss.tenant_id::text IN ($1, $2) AND ${COMPLETED_SESSION}
            AND d."compositeScore" IS NOT NULL
       ),
       ends AS (
         SELECT uid, COUNT(*) AS n,
                (ARRAY_AGG(score ORDER BY at ASC))[1] AS first_score,
                (ARRAY_AGG(score ORDER BY at DESC))[1] AS last_score
           FROM scored GROUP BY uid HAVING COUNT(*) >= 2
       )
       SELECT e.uid, u.name, e.first_score, e.last_score
         FROM ends e JOIN users u ON u.id = e.uid
        WHERE ${LEARNER_ONLY}
        ORDER BY (e.last_score - e.first_score) DESC`,
      params,
    );
    const items = rows.map((r) => {
      const first = Math.round(Number(r.first_score));
      const latest = Math.round(Number(r.last_score));
      const change = latest - first;
      return {
        learnerId: num(r.uid),
        name: String(r.name ?? ''),
        first,
        latest,
        change,
        trend:
          change >= CHANGE_THRESHOLD_POINTS
            ? ('improving' as const)
            : change <= -CHANGE_THRESHOLD_POINTS
              ? ('declining' as const)
              : ('steady' as const),
      };
    });
    const counts = {
      improving: items.filter((i) => i.trend === 'improving').length,
      steady: items.filter((i) => i.trend === 'steady').length,
      declining: items.filter((i) => i.trend === 'declining').length,
    };
    const shown =
      items.length > CHANGE_ROWS_EACH_END * 2
        ? [
            ...items.slice(0, CHANGE_ROWS_EACH_END),
            ...items.slice(-CHANGE_ROWS_EACH_END),
          ]
        : items;
    return { counts, rows: shown };
  }

  /** Average skill level for each course (a row) against each skill (a column). */
  async getSkillsByCourse(
    tenantId: string,
    tenantCode: string,
  ): Promise<SkillGridData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `WITH cut_course AS (
         SELECT DISTINCT c.id AS cut_id, c."userId" AS uid, i."trackId" AS course_id
           FROM foundational_skill_cuts c
           CROSS JOIN LATERAL unnest(c."sessionIds") AS sid
           JOIN scenario_sessions ss ON ss.id = sid
           JOIN track_item_progress p ON p.id = ss."trackItemProgressId"
           JOIN track_items i ON i.id = p."trackItemId"
          WHERE c.tenant_id::text IN ($1, $2)
       )
       SELECT cc.course_id::text AS row_id, t.title, kv.key AS skill,
              AVG(kv.value::numeric) AS level, COUNT(DISTINCT cc.uid) AS learners
         FROM cut_course cc
         JOIN tracks t ON t.id = cc.course_id AND t."deletedAt" IS NULL
         JOIN foundational_skill_assessments a
           ON a."cutId" = cc.cut_id AND a.status = 'SCORED' AND a."rubricVersion" = $3
         CROSS JOIN LATERAL jsonb_each_text(a."skillLevels") kv
        WHERE kv.value ~ '^[0-9]+(\\.[0-9]+)?$'
        GROUP BY cc.course_id, t.title, kv.key
       HAVING COUNT(DISTINCT cc.uid) >= ${DEPTH_MIN_LEARNERS}`,
      [tenantId, tenantCode, FHS_RUBRIC_VERSION],
    );
    return gridOf(rows, COURSE_GRID_ROWS);
  }

  /** Average skill level for each roleplay of a course against each skill, from practice slices that played one roleplay. */
  async getRoleplaySkills(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<SkillGridData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `WITH cut_scenario AS (
         SELECT c.id AS cut_id, c."userId" AS uid, MIN(ss."scenarioId") AS scenario_id
           FROM foundational_skill_cuts c
           CROSS JOIN LATERAL unnest(c."sessionIds") AS sid
           JOIN scenario_sessions ss ON ss.id = sid
          WHERE c.tenant_id::text IN ($1, $2)
          GROUP BY c.id, c."userId"
         HAVING COUNT(DISTINCT ss."scenarioId") = 1
       )
       SELECT i.id::text AS row_id, COALESCE(sc.title, i.title) AS title, kv.key AS skill,
              AVG(kv.value::numeric) AS level, COUNT(DISTINCT cs.uid) AS learners
         FROM track_items i
         JOIN scenarios sc ON sc.id = i."scenarioId"
         JOIN cut_scenario cs ON cs.scenario_id = sc.id
         JOIN foundational_skill_assessments a
           ON a."cutId" = cs.cut_id AND a.status = 'SCORED' AND a."rubricVersion" = $4
         CROSS JOIN LATERAL jsonb_each_text(a."skillLevels") kv
        WHERE i."trackId" = $3::uuid AND i.type = 'ROLEPLAY' AND i."deletedAt" IS NULL
          AND kv.value ~ '^[0-9]+(\\.[0-9]+)?$'
        GROUP BY i.id, i.title, sc.title, kv.key
       HAVING COUNT(DISTINCT cs.uid) >= ${DEPTH_MIN_LEARNERS}`,
      [tenantId, tenantCode, courseId, FHS_RUBRIC_VERSION],
    );
    return gridOf(rows, MODULE_LIMIT);
  }

  /** How often a learner shows each helpful behaviour, against the whole organisation. */
  async getBehavioursAgainstGroup(
    tenantId: string,
    tenantCode: string,
    learnerId: number,
  ): Promise<BehavioursAgainstGroupData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `WITH cuts AS (
         SELECT c.id AS cut_id, c."userId" AS uid, a.verdicts
           FROM foundational_skill_cuts c
           JOIN foundational_skill_assessments a
             ON a."cutId" = c.id AND a.status = 'SCORED' AND a."rubricVersion" = $3
          WHERE c.tenant_id::text IN ($1, $2)
       ),
       totals AS (
         SELECT COUNT(*) AS group_cuts,
                COUNT(*) FILTER (WHERE uid = $4) AS learner_cuts
           FROM cuts
       ),
       seen AS (
         SELECT o.code,
                COUNT(DISTINCT cuts.cut_id) AS group_with,
                COUNT(DISTINCT cuts.cut_id) FILTER (WHERE cuts.uid = $4) AS learner_with
           FROM cuts
           CROSS JOIN LATERAL (
             SELECT jsonb_array_elements_text(v->'observed') AS code
               FROM jsonb_array_elements(cuts.verdicts) v
           ) o
          GROUP BY o.code
       )
       SELECT seen.code, seen.group_with, seen.learner_with, totals.group_cuts, totals.learner_cuts
         FROM seen CROSS JOIN totals`,
      [tenantId, tenantCode, FHS_RUBRIC_VERSION, learnerId],
    );
    const learnerSlices = num(rows[0]?.learner_cuts);
    const groupSlices = num(rows[0]?.group_cuts);
    if (learnerSlices < DEPTH_MIN_LEARNERS || groupSlices === 0) {
      return { learnerSlices, groupSlices, rows: [] };
    }
    const out = rows
      .filter((r) => behaviourInfo.has(String(r.code)))
      .map((r) => {
        const info = behaviourInfo.get(String(r.code))!;
        return {
          code: String(r.code),
          skill: info.skill,
          text: info.text,
          learnerPercent: Math.round(
            (num(r.learner_with) / learnerSlices) * 100,
          ),
          groupPercent: Math.round((num(r.group_with) / groupSlices) * 100),
        };
      })
      // The ones the group shows and this learner does not come first: what is missing.
      .sort(
        (a, b) =>
          b.groupPercent -
            b.learnerPercent -
            (a.groupPercent - a.learnerPercent) || a.code.localeCompare(b.code),
      );
    return { learnerSlices, groupSlices, rows: out.slice(0, BEHAVIOUR_ROWS) };
  }

  /** Completed sessions with no review yet, oldest first, for the organisation or one learner. */
  async getSessionsWaiting(
    tenantId: string,
    tenantCode: string,
    learnerId?: number,
  ): Promise<SessionsWaitingData> {
    const params: unknown[] = [tenantId, tenantCode];
    if (learnerId !== undefined) params.push(learnerId);
    const filter = learnerId !== undefined ? 'AND ss."counselorId" = $3' : '';
    const [list, total]: [
      Array<Record<string, unknown>>,
      Array<{ n: string }>,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT ss.id::text AS session_id, COALESCE(sc.title, '') AS title, u.name,
                  COALESCE(ss."endedAt", ss."createdAt") AS completed_at
             FROM scenario_sessions ss
             JOIN users u ON u.id = ss."counselorId"
             LEFT JOIN scenarios sc ON sc.id = ss."scenarioId"
            WHERE ss.tenant_id::text IN ($1, $2) AND ${COMPLETED_SESSION}
              ${filter}
              AND NOT EXISTS (SELECT 1 FROM scenario_session_reviews r WHERE r."scenarioSessionId" = ss.id)
            ORDER BY COALESCE(ss."endedAt", ss."createdAt") ASC
            LIMIT ${WAITING_ROWS}`,
        params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS n
             FROM scenario_sessions ss
            WHERE ss.tenant_id::text IN ($1, $2) AND ${COMPLETED_SESSION}
              ${filter}
              AND NOT EXISTS (SELECT 1 FROM scenario_session_reviews r WHERE r."scenarioSessionId" = ss.id)`,
        params,
      ),
    ]);
    const now = Date.now();
    return {
      total: num(total[0]?.n),
      rows: list.map((r) => ({
        sessionId: String(r.session_id),
        scenarioTitle: String(r.title),
        learnerName: String(r.name ?? ''),
        completedAt: new Date(r.completed_at as string).toISOString(),
        daysWaiting: Math.max(
          0,
          Math.floor(
            (now - new Date(r.completed_at as string).getTime()) / 86_400_000,
          ),
        ),
      })),
    };
  }

  /** A course's learners grouped by the month they started: how many, how many finished, how they scored. */
  async getCohorts(
    tenantId: string,
    tenantCode: string,
    courseId: string,
  ): Promise<CohortsData> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `WITH scores AS (
         SELECT ss."counselorId" AS uid, AVG(d."compositeScore") AS avg_score
           FROM scenario_sessions ss
           JOIN scenario_session_details d ON d."scenarioSessionId" = ss.id
           JOIN track_item_progress p ON p.id = ss."trackItemProgressId"
           JOIN track_items i ON i.id = p."trackItemId" AND i."trackId" = $3::uuid
          WHERE ss.tenant_id::text IN ($1, $2) AND ${COMPLETED_SESSION}
            AND d."compositeScore" IS NOT NULL
          GROUP BY ss."counselorId"
       )
       SELECT to_char(date_trunc('month', e."startedAt"), 'YYYY-MM-DD') AS start,
              COUNT(*) AS size,
              COUNT(*) FILTER (WHERE e."completedAt" IS NOT NULL) AS completed,
              AVG(sc.avg_score) AS avg_score
         FROM track_enrollments e
         JOIN users u ON u.id = e."userId"
         LEFT JOIN scores sc ON sc.uid = e."userId"
        WHERE e."trackId" = $3::uuid AND e."deletedAt" IS NULL AND e."startedAt" IS NOT NULL
          AND e."tenantId"::text IN ($1, $2)
          AND ${LEARNER_ONLY}
        GROUP BY date_trunc('month', e."startedAt")
        ORDER BY date_trunc('month', e."startedAt") DESC
        LIMIT ${COHORT_ROWS}`,
      [tenantId, tenantCode, courseId],
    );
    return {
      rows: rows
        .map((r) => ({
          start: String(r.start),
          size: num(r.size),
          completedPercent:
            num(r.size) > 0
              ? Math.round((num(r.completed) / num(r.size)) * 100)
              : 0,
          averageScore:
            r.avg_score === null ? null : Math.round(Number(r.avg_score)),
        }))
        .reverse(),
    };
  }

  /** How quickly completed sessions get their first review, over the last 90 days. */
  async getReviewTurnaround(
    tenantId: string,
    tenantCode: string,
    since: Date,
  ): Promise<MeasuresResult> {
    const [row]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT COUNT(*) AS completed,
              COUNT(*) FILTER (WHERE rv.first_at IS NOT NULL) AS reviewed,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (rv.first_at - COALESCE(ss."endedAt", ss."createdAt"))) / 86400.0
              ) FILTER (WHERE rv.first_at IS NOT NULL
                          AND rv.first_at >= COALESCE(ss."endedAt", ss."createdAt")) AS median_days,
              COUNT(*) FILTER (WHERE rv.first_at IS NOT NULL
                                 AND rv.first_at - COALESCE(ss."endedAt", ss."createdAt") <= interval '2 days') AS within_two
         FROM scenario_sessions ss
         LEFT JOIN LATERAL (
           SELECT MIN(r."createdAt") AS first_at FROM scenario_session_reviews r
            WHERE r."scenarioSessionId" = ss.id
         ) rv ON true
        WHERE ss.tenant_id::text IN ($1, $2) AND ${COMPLETED_SESSION}
          AND COALESCE(ss."endedAt", ss."createdAt") >= $3`,
      [tenantId, tenantCode, since],
    );
    const completed = num(row?.completed);
    const reviewed = num(row?.reviewed);
    return {
      measures: [
        { key: 'submitted', value: completed, format: 'count' },
        { key: 'reviewed', value: reviewed, format: 'count' },
        { key: 'pending', value: completed - reviewed, format: 'count' },
        {
          key: 'turnaroundDays',
          value:
            row?.median_days == null ? null : round1(Number(row.median_days)),
          format: 'days',
        },
        {
          key: 'withinTwoDays',
          value:
            reviewed > 0
              ? Math.round((num(row?.within_two) / reviewed) * 100)
              : null,
          format: 'percent',
        },
      ],
    };
  }

  /** Who a learner is and what they are enrolled in. No supervisor: none is recorded. */
  async getLearnerProfile(
    tenantId: string,
    tenantCode: string,
    learnerId: number,
  ): Promise<MeasuresResult> {
    const [row]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT u."createdAt" AS joined,
              (SELECT COUNT(*) FROM track_enrollments e
                WHERE e."userId" = u.id AND e."deletedAt" IS NULL) AS assigned,
              (SELECT COUNT(*) FROM track_enrollments e
                WHERE e."userId" = u.id AND e."deletedAt" IS NULL AND e."completedAt" IS NOT NULL) AS finished,
              (SELECT COUNT(*) FROM tenant_cohort_members m WHERE m."userId" = u.id AND m."deletedAt" IS NULL) AS cohorts,
              (SELECT MAX(COALESCE(ss."endedAt", ss."createdAt")) FROM scenario_sessions ss
                WHERE ss."counselorId" = u.id AND ${COMPLETED_SESSION}
                  AND ss.tenant_id::text IN ($1, $2)) AS last_active
         FROM users u
        WHERE u.id = $3`,
      [tenantId, tenantCode, learnerId],
    );
    const date = (v: unknown): MeasureRow =>
      v
        ? {
            key: '',
            value: null,
            format: 'date',
            text: new Date(v as string).toISOString().slice(0, 10),
          }
        : { key: '', value: null, format: 'date', text: null };
    return {
      measures: [
        { ...date(row?.joined), key: 'joined' },
        { key: 'coursesAssigned', value: num(row?.assigned), format: 'count' },
        { key: 'coursesFinished', value: num(row?.finished), format: 'count' },
        { key: 'cohorts', value: num(row?.cohorts), format: 'count' },
        { ...date(row?.last_active), key: 'lastPracticed' },
      ],
    };
  }

  /** How many scored conversations there are and how many a clinician has checked. */
  async getScoreTrust(
    tenantId: string,
    tenantCode: string,
  ): Promise<MeasuresResult> {
    const [row]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT COUNT(DISTINCT a."cutId") AS scored,
              COUNT(DISTINCT h."cutId") AS checked
         FROM foundational_skill_cuts c
         JOIN foundational_skill_assessments a
           ON a."cutId" = c.id AND a.status = 'SCORED' AND a."rubricVersion" = $3
         LEFT JOIN fhs_human_ratings h ON h."cutId" = c.id AND h."rubricVersion" = $3
        WHERE c.tenant_id::text IN ($1, $2)`,
      [tenantId, tenantCode, FHS_RUBRIC_VERSION],
    );
    const scored = num(row?.scored);
    const checked = num(row?.checked);
    return {
      measures: [
        { key: 'scored', value: scored, format: 'count' },
        { key: 'checked', value: checked, format: 'count' },
        {
          key: 'checkedPercent',
          value: scored > 0 ? Math.round((checked / scored) * 100) : null,
          format: 'percent',
        },
      ],
    };
  }
}

/** Turns (row, skill, level) rows into a grid, keeping the rows with the most skills measured. */
function gridOf(
  rows: Array<Record<string, unknown>>,
  limit: number,
): SkillGridData {
  const titles = new Map<string, string>();
  const reach = new Map<string, number>();
  rows.forEach((r) => {
    titles.set(String(r.row_id), String(r.title));
    reach.set(String(r.row_id), (reach.get(String(r.row_id)) ?? 0) + 1);
  });
  const kept = [...titles.keys()]
    .sort(
      (a, b) =>
        (reach.get(b) ?? 0) - (reach.get(a) ?? 0) ||
        titles.get(a)!.localeCompare(titles.get(b)!),
    )
    .slice(0, limit);
  const keep = new Set(kept);
  const skills = [
    ...new Set(
      rows
        .filter((r) => keep.has(String(r.row_id)))
        .map((r) => String(r.skill)),
    ),
  ].sort();
  return {
    rows: kept.map((id) => ({ id, title: titles.get(id)! })),
    skills,
    cells: rows
      .filter((r) => keep.has(String(r.row_id)))
      .map((r) => ({
        rowId: String(r.row_id),
        skill: String(r.skill),
        level: round1(Number(r.level)),
        learners: num(r.learners),
      })),
  };
}
