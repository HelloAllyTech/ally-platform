import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  excludeTestTenants,
  excludeTestTenantsByUser,
  scopeToTenant,
  scopeToTenantByUser,
} from '../util/test-tenant.util';

/**
 * Raw reads for the Ally guide's analytics (AAQ-240..251, plans/ally-guide/
 * plan.md §4.13). Every query starts from the signed-in learners' Ally
 * conversations (`guide_threads` with a user, not merged away), with test
 * organisations excluded and, when asked, one organisation only. Counts
 * only; the service applies the minimum group size.
 *
 * Parameters: $1 window start, $2 window end (exclusive), $3 tenant (when
 * scoped).
 */

export interface WeeklyActivityRow {
  week: string;
  learners: number;
  voiceLearners: number;
  learnerMessages: number;
  learnerDays: number;
}
export interface WeeklyFirstWinRow {
  week: string;
  newThreads: number;
  learners: number;
  winsInSession: number;
  winsWithin5Min: number;
}
export interface WeeklyItemsRow {
  week: string;
  items: number;
  learners: number;
}
export interface WeeklyReturnRow {
  week: string;
  cohort: number;
  returned: number;
}
export interface WeeklyAppointmentRow {
  week: string;
  set: number;
  due: number;
  kept: number;
  learners: number;
}
export interface WeeklyLearningRow {
  week: string;
  ally: boolean;
  attempts: number;
  learners: number;
  rate: number | null;
}
export interface WeeklyHealthRow {
  week: string;
  learners: number;
  learnerTurns: number;
  refusals: number;
  offCourse: number;
  careEntries: number;
  costUsd: number;
}
export interface WeeklyCrisisRow {
  week: string;
  crisisEntries: number;
}
export interface WeeklyThumbsRow {
  week: string;
  up: number;
  down: number;
  learners: number;
}
export interface CourseCostRow {
  trackId: string;
  title: string;
  learners: number;
  turns: number;
  costUsd: number;
}
export interface AllyGuideTotalsRow {
  learners: number;
  conversations: number;
  learnerMessages: number;
  thumbsUp: number;
  thumbsDown: number;
  ratingLearners: number;
  costUsd: number;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

@Injectable()
export class AllyGuideAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The signed-in learners' Ally conversations in scope, as a CTE. */
  private threads(tenantId?: string): string {
    return `th AS (
      SELECT g."id", g."userId", g."trackId", g."tenant_id" AS "tenantId",
             g."createdAt", g."pacing"
        FROM "guide_threads" g
       WHERE g."userId" IS NOT NULL AND g."mergedIntoThreadId" IS NULL
         AND ${excludeTestTenants('g."tenant_id"')}
         ${tenantId ? `AND ${scopeToTenant('g."tenant_id"', '$3')}` : ''})`;
  }

  private params(start: Date, end: Date, tenantId?: string): unknown[] {
    return tenantId ? [start, end, tenantId] : [start, end];
  }

  private async run<T>(
    sql: string,
    start: Date,
    end: Date,
    tenantId: string | undefined,
    map: (row: Record<string, any>) => T,
  ): Promise<T[]> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      sql,
      this.params(start, end, tenantId),
    );
    return rows.map(map);
  }

  totals(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)},
       msgs AS (
         SELECT th."userId", m."threadId" FROM "guide_messages" m
           JOIN th ON th."id" = m."threadId"
          WHERE m."role" = 'learner' AND m."createdAt" >= $1 AND m."createdAt" < $2),
       thumbs AS (
         SELECT f."rating", f."userId" FROM "guide_turn_feedback" f
           JOIN "guide_messages" m ON m."id" = f."messageId"
           JOIN th ON th."id" = m."threadId"
          WHERE f."createdAt" >= $1 AND f."createdAt" < $2),
       cost AS (
         SELECT COALESCE(sum(t."costUsd"), 0) AS usd FROM "agent_turns" t
           JOIN th ON th."id" = t."threadId"
          WHERE t."createdAt" >= $1 AND t."createdAt" < $2)
       SELECT (SELECT count(DISTINCT "userId") FROM msgs) AS learners,
              (SELECT count(DISTINCT "threadId") FROM msgs) AS conversations,
              (SELECT count(*) FROM msgs) AS "learnerMessages",
              (SELECT count(*) FILTER (WHERE "rating" > 0) FROM thumbs) AS "thumbsUp",
              (SELECT count(*) FILTER (WHERE "rating" < 0) FROM thumbs) AS "thumbsDown",
              (SELECT count(DISTINCT "userId") FROM thumbs) AS "ratingLearners",
              (SELECT usd FROM cost) AS "costUsd"`,
      start,
      end,
      tenantId,
      (r): AllyGuideTotalsRow => ({
        learners: num(r.learners),
        conversations: num(r.conversations),
        learnerMessages: num(r.learnerMessages),
        thumbsUp: num(r.thumbsUp),
        thumbsDown: num(r.thumbsDown),
        ratingLearners: num(r.ratingLearners),
        costUsd: num(r.costUsd),
      }),
    ).then((rows) => rows[0]);
  }

  activity(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', m."createdAt") AS week,
              count(DISTINCT th."userId") AS learners,
              count(DISTINCT th."userId") FILTER (WHERE m."channel" = 'voice') AS "voiceLearners",
              count(*) AS "learnerMessages",
              count(DISTINCT (th."userId", date_trunc('day', m."createdAt"))) AS "learnerDays"
         FROM "guide_messages" m JOIN th ON th."id" = m."threadId"
        WHERE m."role" = 'learner' AND m."createdAt" >= $1 AND m."createdAt" < $2
        GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyActivityRow => ({
        week: iso(r.week),
        learners: num(r.learners),
        voiceLearners: num(r.voiceLearners),
        learnerMessages: num(r.learnerMessages),
        learnerDays: num(r.learnerDays),
      }),
    );
  }

  /**
   * New conversations by week, and how many reached their first win (the
   * first completed item, `pacing.firstWinAt`) within the first session (an
   * hour, the epoch's idle limit) and within 5 minutes (plan §4.5).
   */
  firstWins(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)},
       won AS (
         SELECT th.*, ((th."pacing"->>'firstWinAt')::timestamptz AT TIME ZONE 'UTC') AS "winAt"
           FROM th WHERE th."createdAt" >= $1 AND th."createdAt" < $2)
       SELECT date_trunc('week', "createdAt") AS week,
              count(*) AS "newThreads",
              count(DISTINCT "userId") AS learners,
              count(*) FILTER (WHERE "winAt" <= "createdAt" + interval '60 minutes') AS "winsInSession",
              count(*) FILTER (WHERE "winAt" <= "createdAt" + interval '5 minutes') AS "winsWithin5Min"
         FROM won GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyFirstWinRow => ({
        week: iso(r.week),
        newThreads: num(r.newThreads),
        learners: num(r.learners),
        winsInSession: num(r.winsInSession),
        winsWithin5Min: num(r.winsWithin5Min),
      }),
    );
  }

  /** Items Ally learners completed on the course of their Ally conversation. */
  items(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', tip."completedAt") AS week,
              count(*) AS items, count(DISTINCT tip."userId") AS learners
         FROM "track_item_progress" tip
         JOIN "track_enrollments" te ON te."id" = tip."trackEnrollmentId"
        WHERE tip."status" = 'COMPLETED' AND tip."deletedAt" IS NULL
          AND tip."completedAt" >= $1 AND tip."completedAt" < $2
          AND EXISTS (SELECT 1 FROM th WHERE th."userId" = te."userId" AND th."trackId" = te."trackId")
        GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyItemsRow => ({
        week: iso(r.week),
        items: num(r.items),
        learners: num(r.learners),
      }),
    );
  }

  /** Learners by the week of their first Ally day, and who came back within 7 days. */
  returns(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)},
       days AS (
         SELECT DISTINCT th."userId", date_trunc('day', m."createdAt") AS day
           FROM "guide_messages" m JOIN th ON th."id" = m."threadId"
          WHERE m."role" = 'learner' AND m."createdAt" >= $1
            AND m."createdAt" < $2::timestamp + interval '7 days'),
       firsts AS (
         SELECT "userId", date_trunc('week', day) AS week, min(day) AS first
           FROM days WHERE day < $2 GROUP BY 1, 2)
       SELECT f.week, count(*) AS cohort,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM days d WHERE d."userId" = f."userId"
                   AND d.day > f.first AND d.day <= f.first + interval '7 days')) AS returned
         FROM firsts f GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyReturnRow => ({
        week: iso(r.week),
        cohort: num(r.cohort),
        returned: num(r.returned),
      }),
    );
  }

  /** Closing-ritual appointments set, due, and kept (the learner wrote within a day of it). */
  appointments(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', a."createdAt") AS week,
              count(*) AS set,
              count(DISTINCT a."userId") AS learners,
              count(*) FILTER (WHERE a."at" < now() AND a."status" <> 'cancelled') AS due,
              count(*) FILTER (WHERE a."at" < now() AND a."status" <> 'cancelled' AND EXISTS (
                SELECT 1 FROM "guide_messages" m
                 WHERE m."threadId" = a."threadId" AND m."role" = 'learner'
                   AND m."createdAt" >= (a."at" AT TIME ZONE 'UTC') - interval '1 hour'
                   AND m."createdAt" < (a."at" AT TIME ZONE 'UTC') + interval '24 hours')) AS kept
         FROM "guide_appointments" a JOIN th ON th."id" = a."threadId"
        WHERE a."purpose" = 'session' AND a."createdAt" >= $1 AND a."createdAt" < $2
        GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyAppointmentRow => ({
        week: iso(r.week),
        set: num(r.set),
        due: num(r.due),
        kept: num(r.kept),
        learners: num(r.learners),
      }),
    );
  }

  /**
   * Quiz first attempts on the courses Ally runs on, split by whether the
   * learner had an Ally conversation on that course. The classic side is a
   * reference line, not a control group: learners chose their experience.
   */
  quizFirstAttempts(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', a."createdAt") AS week,
              EXISTS (SELECT 1 FROM th WHERE th."userId" = a."userId" AND th."trackId" = ti."trackId") AS ally,
              count(*) AS attempts, count(DISTINCT a."userId") AS learners,
              avg((a."passed" IS TRUE)::int) AS rate
         FROM "track_quiz_attempts" a
         JOIN "track_items" ti ON ti."id" = a."trackItemId"
        WHERE a."attemptNumber" = 1 AND a."status" <> 'PENDING_GRADING' AND a."deletedAt" IS NULL
          AND a."createdAt" >= $1 AND a."createdAt" < $2
          AND ti."trackId" IN (SELECT "trackId" FROM th)
          AND ${excludeTestTenantsByUser('a."userId"')}
          ${tenantId ? `AND ${scopeToTenantByUser('a."userId"', '$3')}` : ''}
        GROUP BY 1, 2 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyLearningRow => ({
        week: iso(r.week),
        ally: Boolean(r.ally),
        attempts: num(r.attempts),
        learners: num(r.learners),
        rate: r.rate === null ? null : Number(Number(r.rate).toFixed(4)),
      }),
    );
  }

  /** Roleplay scores recorded when the item completed, same split as the quiz. */
  roleplayScores(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', tip."completedAt") AS week,
              EXISTS (SELECT 1 FROM th WHERE th."userId" = tip."userId" AND th."trackId" = ti."trackId") AS ally,
              count(*) AS attempts, count(DISTINCT tip."userId") AS learners,
              avg(tip."score") AS rate
         FROM "track_item_progress" tip
         JOIN "track_items" ti ON ti."id" = tip."trackItemId"
        WHERE ti."type" = 'ROLEPLAY' AND tip."status" = 'COMPLETED' AND tip."score" IS NOT NULL
          AND tip."deletedAt" IS NULL
          AND tip."completedAt" >= $1 AND tip."completedAt" < $2
          AND ti."trackId" IN (SELECT "trackId" FROM th)
          AND ${excludeTestTenantsByUser('tip."userId"')}
          ${tenantId ? `AND ${scopeToTenantByUser('tip."userId"', '$3')}` : ''}
        GROUP BY 1, 2 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyLearningRow => ({
        week: iso(r.week),
        ally: Boolean(r.ally),
        attempts: num(r.attempts),
        learners: num(r.learners),
        rate: r.rate === null ? null : Number(Number(r.rate).toFixed(2)),
      }),
    );
  }

  /** Turns, refusals, off-course turns, CARE entries and cost, by week. */
  health(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', t."createdAt") AS week,
              count(DISTINCT th."userId") AS learners,
              count(*) FILTER (WHERE t."trigger" = 'learner_message') AS "learnerTurns",
              count(*) FILTER (WHERE tr."summary"->>'replyKind' = 'refusal') AS refusals,
              count(*) FILTER (WHERE t."trigger" = 'learner_message'
                                 AND COALESCE((tr."summary"->'steer'->>'level')::int, 0) >= 1) AS "offCourse",
              count(*) FILTER (WHERE tr."summary"->>'modeAfter' = 'CARE'
                                 AND COALESCE(tr."summary"->>'modeBefore', '') <> 'CARE') AS "careEntries",
              COALESCE(sum(t."costUsd"), 0) AS "costUsd"
         FROM "agent_turns" t
         JOIN th ON th."id" = t."threadId"
         LEFT JOIN "agent_turn_traces" tr ON tr."turnId" = t."id"
        WHERE t."agentKey" = 'ally_guide' AND t."createdAt" >= $1 AND t."createdAt" < $2
        GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyHealthRow => ({
        week: iso(r.week),
        learners: num(r.learners),
        learnerTurns: num(r.learnerTurns),
        refusals: num(r.refusals),
        offCourse: num(r.offCourse),
        careEntries: num(r.careEntries),
        costUsd: num(r.costUsd),
      }),
    );
  }

  crises(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', s."occurredAt") AS week, count(*) AS "crisisEntries"
         FROM "guide_signals" s JOIN th ON th."id" = s."threadId"
        WHERE s."kind" = 'crisis_entered' AND s."occurredAt" >= $1 AND s."occurredAt" < $2
        GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyCrisisRow => ({
        week: iso(r.week),
        crisisEntries: num(r.crisisEntries),
      }),
    );
  }

  thumbs(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT date_trunc('week', f."createdAt") AS week,
              count(*) FILTER (WHERE f."rating" > 0) AS up,
              count(*) FILTER (WHERE f."rating" < 0) AS down,
              count(DISTINCT f."userId") AS learners
         FROM "guide_turn_feedback" f
         JOIN "guide_messages" m ON m."id" = f."messageId"
         JOIN th ON th."id" = m."threadId"
        WHERE f."createdAt" >= $1 AND f."createdAt" < $2
        GROUP BY 1 ORDER BY 1`,
      start,
      end,
      tenantId,
      (r): WeeklyThumbsRow => ({
        week: iso(r.week),
        up: num(r.up),
        down: num(r.down),
        learners: num(r.learners),
      }),
    );
  }

  courses(start: Date, end: Date, tenantId?: string) {
    return this.run(
      `WITH ${this.threads(tenantId)}
       SELECT th."trackId", tr."title",
              count(DISTINCT th."userId") AS learners,
              count(*) AS turns,
              COALESCE(sum(t."costUsd"), 0) AS "costUsd"
         FROM "agent_turns" t
         JOIN th ON th."id" = t."threadId"
         JOIN "tracks" tr ON tr."id" = th."trackId"
        WHERE t."createdAt" >= $1 AND t."createdAt" < $2
        GROUP BY 1, 2 ORDER BY "costUsd" DESC`,
      start,
      end,
      tenantId,
      (r): CourseCostRow => ({
        trackId: String(r.trackId),
        title: String(r.title),
        learners: num(r.learners),
        turns: num(r.turns),
        costUsd: num(r.costUsd),
      }),
    );
  }

  /** The first day any Ally conversation exists: the all-time window's start. */
  async dataFloor(): Promise<Date | undefined> {
    const [row]: Array<{ first: Date | null }> = await this.dataSource.query(
      `SELECT min("createdAt") AS first FROM "guide_threads"`,
    );
    return row?.first ? new Date(row.first) : undefined;
  }
}
