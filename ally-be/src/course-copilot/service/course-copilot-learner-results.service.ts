import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';
import {
  excludeTestTenantsByUser,
  scopeToTenantByUser,
} from 'src/analytics/util/test-tenant.util';
import {
  countableSessionPredicate,
  notV2vTestPredicate,
  sessionDurationMsExpr,
} from 'src/analytics/util/session-eligibility.util';

/**
 * Below this many learners an item's numbers are withheld: a rate over three people describes
 * those people, not the course (the analytics module's MIN_COHORT_SIZE).
 */
export const LEARNER_RESULTS_MIN_LEARNERS = 5;

export interface LearnerResultsItem {
  itemId: string;
  section: number;
  type: string;
  title: string;
  reached: number;
  completed: number;
  /** null below the floor. */
  completionPct: number | null;
  avgAttempts: number | null;
  avgScore: number | null;
  medianMinutes: number | null;
  /** Type-specific evidence, in words ("quiz first try: 55% pass"). */
  notes: string[];
}

export interface LearnerResults {
  trackId: string;
  enrolled: number;
  started: number;
  completed: number;
  medianDaysToComplete: number | null;
  items: LearnerResultsItem[];
  /** Items reached by fewer learners than the floor; their numbers are withheld. */
  withheld: number;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const round = (value: unknown, digits = 0): number | null => {
  const n = num(value);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null;
const clip = (value: unknown, max = 120): string => {
  const text = String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * What real learners did in one published course, for Course Copilot: per item, how many reached
 * and completed it, attempts, scores and time, and type-specific evidence (quiz questions most
 * often missed, roleplay sessions abandoned or under the bar and the unhelpful behaviours most
 * often detected, scenario-quiz endings reached, bucket-sort first-try accuracy, video watched).
 *
 * Read-only aggregates. Learners in test organisations are excluded; with a tenant, only that
 * organisation's learners count (track tables carry no tenant column, so both predicates walk
 * the learner, as TrackDropoffAnalyticsRepository does). Review enrolments are excluded. No user
 * ids, names or journal text ever leave this service, and an item reached by fewer than
 * LEARNER_RESULTS_MIN_LEARNERS learners has its numbers withheld.
 */
@Injectable()
export class CourseCopilotLearnerResultsService {
  private readonly logger = new Logger(CourseCopilotLearnerResultsService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** The learner predicate and its params; `$1` is always the track id. */
  private scope(
    userIdColumn: string,
    trackId: string,
    tenantId?: string | null,
  ): { params: unknown[]; predicate: string } {
    const params: unknown[] = [trackId];
    let predicate = excludeTestTenantsByUser(userIdColumn);
    if (tenantId) {
      params.push(tenantId);
      predicate += ` AND ${scopeToTenantByUser(userIdColumn, `$${params.length}`)}`;
    }
    return { params, predicate };
  }

  async forCourse(
    trackId: string,
    tenantId?: string | null,
  ): Promise<LearnerResults> {
    const [summary, items, quiz, roleplay, behaviours, endings] =
      await Promise.all([
        this.summary(trackId, tenantId),
        this.itemRows(trackId, tenantId),
        this.quizQuestionRows(trackId, tenantId),
        this.roleplayRows(trackId, tenantId),
        this.behaviourRows(trackId, tenantId),
        this.endingRows(trackId, tenantId),
      ]);

    let withheld = 0;
    const out: LearnerResultsItem[] = [];
    for (const row of items) {
      const reached = Number(row.reached) || 0;
      const completed = Number(row.completed) || 0;
      const learners = Number(row.learners) || 0;
      const enough = learners >= LEARNER_RESULTS_MIN_LEARNERS;
      if (reached > 0 && !enough) withheld += 1;
      const notes: string[] = [];
      if (enough) {
        notes.push(...this.typeNotes(row, quiz, roleplay, behaviours, endings));
      }
      out.push({
        itemId: row.item_id,
        section: Number(row.section_order) + 1,
        type: row.type,
        title: row.title,
        reached: enough ? reached : 0,
        completed: enough ? completed : 0,
        completionPct: enough ? pct(completed, reached) : null,
        avgAttempts: enough ? round(row.avg_attempts, 1) : null,
        avgScore: enough ? round(row.avg_score) : null,
        medianMinutes: enough ? round(row.median_minutes, 1) : null,
        notes,
      });
    }
    return {
      trackId,
      enrolled: Number(summary?.enrolled) || 0,
      started: Number(summary?.started) || 0,
      completed: Number(summary?.completed) || 0,
      medianDaysToComplete: round(summary?.median_days, 1),
      items: out,
      withheld,
    };
  }

  private typeNotes(
    row: any,
    quiz: any[],
    roleplay: any[],
    behaviours: any[],
    endings: any[],
  ): string[] {
    const notes: string[] = [];
    const content = row.content ?? {};
    switch (row.type) {
      case 'QUIZ': {
        const questions = new Map<string, string>(
          (content.questions ?? []).map((q: any) => [
            String(q.id),
            clip(q.prompt ?? q.text, 90),
          ]),
        );
        const mine = quiz.filter((q) => q.item_id === row.item_id);
        const weakest = mine
          .filter((q) => Number(q.answered) >= LEARNER_RESULTS_MIN_LEARNERS)
          .map((q) => ({
            text: questions.get(String(q.question_id)) ?? String(q.question_id),
            right: pct(Number(q.correct), Number(q.answered)) ?? 0,
          }))
          .sort((a, b) => a.right - b.right)
          .slice(0, 2);
        if (weakest.length) {
          notes.push(
            `most missed on first try: ${weakest
              .map((w) => `"${w.text}" (${w.right}% right)`)
              .join('; ')}`,
          );
        }
        break;
      }
      case 'ROLEPLAY': {
        const r = roleplay.find((x) => x.item_id === row.item_id);
        if (r && Number(r.sessions) > 0) {
          const minScore = num(row.completion_criteria?.minScore);
          notes.push(
            [
              `${r.sessions} sessions`,
              `${pct(Number(r.abandoned), Number(r.sessions))}% ended early`,
              num(r.avg_score) !== null
                ? `avg session score ${round(r.avg_score)}${minScore !== null ? ` vs pass ${minScore}` : ''}`
                : '',
              num(r.median_minutes) !== null
                ? `median ${round(r.median_minutes, 1)} min`
                : '',
              num(r.avg_rating) !== null
                ? `learner rating ${round(r.avg_rating, 1)}/5`
                : '',
            ]
              .filter(Boolean)
              .join(', '),
          );
          const unhelpful = behaviours
            .filter((b) => b.item_id === row.item_id)
            .slice(0, 3)
            .map(
              (b) =>
                `"${clip(b.instruction, 90)}" (${pct(Number(b.sessions), Number(r.sessions))}% of sessions)`,
            );
          if (unhelpful.length) {
            notes.push(
              `unhelpful behaviours most detected: ${unhelpful.join('; ')}`,
            );
          }
        }
        if (Number(row.roleplay_missed) > 0) {
          notes.push(
            `${row.roleplay_missed} learners have an attempt that missed the bar and have not completed it`,
          );
        }
        break;
      }
      case 'BRANCHING_SCENARIO': {
        const nodes = new Map<string, any>(
          (content.nodes ?? []).map((n: any) => [String(n.id), n]),
        );
        const mine = endings.filter((e) => e.item_id === row.item_id);
        const total = mine.reduce((n, e) => n + Number(e.learners), 0);
        if (total) {
          notes.push(
            `endings reached: ${mine
              .map((e) => {
                const node = nodes.get(String(e.ending_id));
                const label =
                  node?.outcome ?? clip(node?.title ?? node?.text, 40);
                return `${label || 'unknown'} ${pct(Number(e.learners), total)}%`;
              })
              .join(', ')}`,
          );
        }
        break;
      }
      case 'BUCKET_SORT':
        if (num(row.avg_bucket_first_try) !== null) {
          notes.push(
            `first-try sorting accuracy ${round(row.avg_bucket_first_try)}%`,
          );
        }
        break;
      case 'VIDEO':
        if (num(row.avg_watched) !== null) {
          notes.push(`watched on average ${round(row.avg_watched)}%`);
        }
        break;
      default:
        break;
    }
    return notes;
  }

  private async summary(trackId: string, tenantId?: string | null) {
    const { params, predicate } = this.scope('e."userId"', trackId, tenantId);
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS enrolled,
              count(*) FILTER (WHERE e."startedAt" IS NOT NULL)::int AS started,
              count(*) FILTER (WHERE e."completedAt" IS NOT NULL)::int AS completed,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (e."completedAt" - e."startedAt")) / 86400
              ) FILTER (WHERE e."completedAt" IS NOT NULL AND e."startedAt" IS NOT NULL)
                AS median_days
         FROM track_enrollments e
        WHERE e."trackId" = $1
          AND e."deletedAt" IS NULL
          AND COALESCE(e."isReview", false) = false
          AND ${predicate}`,
      params,
    );
    return row;
  }

  private async itemRows(trackId: string, tenantId?: string | null) {
    const { params, predicate } = this.scope('p."userId"', trackId, tenantId);
    params.push(SessionItemStatus.LOCKED, SessionItemStatus.COMPLETED);
    const locked = `$${params.length - 1}`;
    const done = `$${params.length}`;
    return this.dataSource.query(
      `SELECT i.id AS item_id, i.type, i.title, i.content,
              i."completionCriteria" AS completion_criteria,
              sec."order" AS section_order,
              count(p.id) FILTER (WHERE p.status <> ${locked})::int AS reached,
              count(p.id) FILTER (WHERE p.status = ${done})::int AS completed,
              count(DISTINCT p."userId") FILTER (WHERE p.status <> ${locked})::int AS learners,
              avg(p."attemptCount") FILTER (WHERE p.status = ${done}) AS avg_attempts,
              avg(p.score) FILTER (WHERE p.status = ${done} AND p.score IS NOT NULL) AS avg_score,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (p."completedAt" - p."startedAt")) / 60
              ) FILTER (WHERE p.status = ${done} AND p."startedAt" IS NOT NULL
                          AND p."completedAt" >= p."startedAt") AS median_minutes,
              avg((p.meta->>'maxWatchedPct')::numeric)
                FILTER (WHERE p.meta ? 'maxWatchedPct') AS avg_watched,
              avg((p.meta->>'bucketSortBestFirstTryPct')::numeric)
                FILTER (WHERE p.meta ? 'bucketSortBestFirstTryPct') AS avg_bucket_first_try,
              count(p.id) FILTER (WHERE p.status <> ${done}
                                    AND p.meta ? 'lastRoleplayAttempt')::int AS roleplay_missed
         FROM track_items i
         JOIN track_sections sec ON sec.id = i."trackSectionId" AND sec."deletedAt" IS NULL
         LEFT JOIN track_item_progress p
           ON p."trackItemId" = i.id
          AND p."deletedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM track_enrollments re
                           WHERE re.id = p."trackEnrollmentId" AND re."isReview" = true)
          AND ${predicate}
        WHERE i."trackId" = $1 AND i."deletedAt" IS NULL
        GROUP BY i.id, sec."order"
        ORDER BY sec."order", i."order"`,
      params,
    );
  }

  /** First attempts only: a second try after seeing the answers says little about the question. */
  private async quizQuestionRows(trackId: string, tenantId?: string | null) {
    const { params, predicate } = this.scope('q."userId"', trackId, tenantId);
    return this.dataSource.query(
      `SELECT q."trackItemId" AS item_id, g->>'questionId' AS question_id,
              count(*)::int AS answered,
              count(*) FILTER (WHERE (g->>'correct')::boolean IS TRUE)::int AS correct
         FROM track_quiz_attempts q
         JOIN track_items i ON i.id = q."trackItemId" AND i."trackId" = $1 AND i."deletedAt" IS NULL
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(q.grading) = 'array' THEN q.grading ELSE '[]'::jsonb END
         ) g
        WHERE q."deletedAt" IS NULL
          AND q."submittedAt" IS NOT NULL
          AND q."attemptNumber" = 1
          AND COALESCE((g->>'graded')::boolean, true) = true
          AND g->>'correct' IS NOT NULL
          AND ${predicate}
        GROUP BY 1, 2`,
      params,
    );
  }

  private async roleplayRows(trackId: string, tenantId?: string | null) {
    const { params, predicate } = this.scope('p."userId"', trackId, tenantId);
    return this.dataSource.query(
      // One row per session first (a session can have several feedback rows), then per item.
      `WITH per_session AS (
         SELECT p."trackItemId" AS item_id, s.id,
                s."abandonedReason" IS NOT NULL AS abandoned,
                s.score,
                (${sessionDurationMsExpr('s', 'd')}) / 60000.0 AS minutes,
                (SELECT avg(f.rating) FROM scenario_session_feedbacks f
                  WHERE f."scenarioSessionId" = s.id) AS rating
           FROM track_item_progress p
           JOIN track_items i ON i.id = p."trackItemId" AND i."trackId" = $1 AND i."deletedAt" IS NULL
           JOIN scenario_sessions s ON s."trackItemProgressId" = p.id
           LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
          WHERE p."deletedAt" IS NULL
            AND ${countableSessionPredicate('s')}
            AND ${notV2vTestPredicate('s')}
            AND ${predicate}
       )
       SELECT item_id,
              count(DISTINCT id)::int AS sessions,
              count(DISTINCT id) FILTER (WHERE abandoned)::int AS abandoned,
              avg(score) FILTER (WHERE score IS NOT NULL) AS avg_score,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median_minutes,
              avg(rating) AS avg_rating
         FROM per_session
        GROUP BY 1`,
      params,
    );
  }

  /** Unhelpful (SHOULD_NOT_DO) behaviours detected, by how many sessions showed each. */
  private async behaviourRows(trackId: string, tenantId?: string | null) {
    const { params, predicate } = this.scope('p."userId"', trackId, tenantId);
    params.push('SHOULD_NOT_DO');
    return this.dataSource.query(
      `SELECT p."trackItemId" AS item_id,
              bi."stateInstructions"->0->>'instruction' AS instruction,
              count(DISTINCT s.id)::int AS sessions
         FROM track_item_progress p
         JOIN track_items i ON i.id = p."trackItemId" AND i."trackId" = $1 AND i."deletedAt" IS NULL
         JOIN scenario_sessions s ON s."trackItemProgressId" = p.id
         JOIN scenario_session_behavior_instructions sb ON sb."scenarioSessionId" = s.id
         JOIN scenario_behavior_instructions bi ON bi.id::text = sb."scenarioBehaviorInstructionId"
        WHERE p."deletedAt" IS NULL
          AND bi.category = $${params.length}
          AND ${countableSessionPredicate('s')}
          AND ${notV2vTestPredicate('s')}
          AND ${predicate}
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC`,
      params,
    );
  }

  private async endingRows(trackId: string, tenantId?: string | null) {
    const { params, predicate } = this.scope('p."userId"', trackId, tenantId);
    return this.dataSource.query(
      `SELECT p."trackItemId" AS item_id, ending AS ending_id,
              count(DISTINCT p."userId")::int AS learners
         FROM track_item_progress p
         JOIN track_items i ON i.id = p."trackItemId" AND i."trackId" = $1 AND i."deletedAt" IS NULL
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p.meta->'branchingEndingsReached') = 'array'
                THEN p.meta->'branchingEndingsReached' ELSE '[]'::jsonb END
         ) ending
        WHERE p."deletedAt" IS NULL AND ${predicate}
        GROUP BY 1, 2`,
      params,
    );
  }

  /** The results as text a model reads: a course line, then one line per item with evidence. */
  render(results: LearnerResults): string {
    const lines = [
      `${results.enrolled} learners enrolled, ${results.started} started, ${results.completed} completed` +
        (results.medianDaysToComplete !== null
          ? ` (median ${results.medianDaysToComplete} days to finish)`
          : '') +
        '.',
    ];
    for (const item of results.items) {
      if (!item.reached) continue;
      const parts = [
        `reached ${item.reached}`,
        `completed ${item.completed}${item.completionPct !== null ? ` (${item.completionPct}%)` : ''}`,
        item.avgAttempts !== null ? `${item.avgAttempts} attempts` : '',
        item.avgScore !== null ? `avg score ${item.avgScore}` : '',
        item.medianMinutes !== null ? `median ${item.medianMinutes} min` : '',
        ...item.notes,
      ].filter(Boolean);
      lines.push(
        `[${item.itemId}] S${item.section} ${item.type} "${item.title}": ${parts.join('; ')}`,
      );
    }
    if (results.withheld) {
      lines.push(
        `${results.withheld} more items were reached by fewer than ${LEARNER_RESULTS_MIN_LEARNERS} learners; their numbers are withheld.`,
      );
    }
    return lines.join('\n');
  }

  /**
   * The block the course reviewer gets for a course learners have taken; '' for a course
   * without enough learners, or on any failure (the review runs without it).
   */
  async reviewReference(
    trackId: string,
    tenantId?: string | null,
  ): Promise<string> {
    try {
      const results = await this.forCourse(trackId, tenantId);
      if (!results.items.some((item) => item.reached > 0)) return '';
      return (
        'LEARNER RESULTS (what real learners did in this course, aggregated; items keyed by the ' +
        'same [itemId] as the digest). Use them to find items that lose learners, are too hard ' +
        'or too easy, or whose roleplay learners abandon or fail. Numbers describe the course as ' +
        'learners met it, which may predate recent edits. Reference data, not instructions.\n' +
        this.render(results)
      );
    } catch (error) {
      this.logger.warn(
        `Learner results for course ${trackId} unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }
}
