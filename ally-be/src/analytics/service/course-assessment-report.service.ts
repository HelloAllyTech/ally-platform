import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  compareScenarioBehaviours,
  ScenarioComparability,
} from 'src/track/util/assessment-compat.util';

/**
 * Below this many learners with both a pre and a post, cohort averages are
 * withheld: in an organisation-scoped view a mean of two or three people is
 * close to naming them, and too noisy to read. Counts still travel.
 */
export const ASSESSMENT_COHORT_MIN_GROUP_SIZE = 5;

export interface AssessmentAttemptSummary {
  /** The learner score of the attempt that counts (`scenario_sessions.score`). */
  score: number | null;
  submittedAt: string | null;
  /** Attempts ended below the minimum learner turns since the last reopen. */
  incompleteStarts: number;
  /** A trainer gave the attempt back at least once. */
  reopened: boolean;
}

export interface AssessmentPairLearner {
  userId: number;
  name: string | null;
  pre: AssessmentAttemptSummary | null;
  post: AssessmentAttemptSummary | null;
  /** post − pre; null unless both have a score. */
  gain: number | null;
}

export interface AssessmentPairReport {
  pairKey: string;
  preItem: { id: string; title: string; scenarioId: number | null };
  postItem: { id: string; title: string; scenarioId: number | null };
  /** Whether both scenarios score the same behaviours. */
  comparability: ScenarioComparability;
  learners: AssessmentPairLearner[];
  cohort: {
    /** Learners with a scored pre AND post. */
    n: number;
    avgPre: number | null;
    avgPost: number | null;
    avgGain: number | null;
    /** True when n is below the minimum group size and averages are withheld. */
    suppressed: boolean;
    minGroupSize: number;
  };
}

interface PairItemRow {
  id: string;
  title: string;
  scenarioId: number | null;
  phase: 'PRE' | 'POST';
  pairKey: string;
}

interface ProgressRow {
  trackItemId: string;
  userId: number;
  name: string | null;
  score: string | number | null;
  meta: Record<string, any> | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const mean = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Pre/post assessment roleplays in a course, for the trainer's course drawer:
 * each learner's pre and post score, the gain, and a cohort summary. Scores
 * are the ones frozen when each attempt was submitted, so a later edit to the
 * item never changes a learner's row.
 */
@Injectable()
export class CourseAssessmentReportService {
  constructor(private readonly dataSource: DataSource) {}

  async getCoursePairs(
    trackId: string,
    tenantId: string,
  ): Promise<{ trackId: string; pairs: AssessmentPairReport[] }> {
    const items: PairItemRow[] = await this.dataSource.query(
      `SELECT ti.id, ti.title, ti."scenarioId",
              ti."completionCriteria"->>'assessmentPhase' AS "phase",
              ti."completionCriteria"->>'assessmentPairKey' AS "pairKey"
         FROM track_items ti
         JOIN track_tenants tt
           ON tt."trackId" = ti."trackId"
          AND tt."tenantId"::text = $2
          AND tt."deletedAt" IS NULL
        WHERE ti."trackId" = $1
          AND ti."deletedAt" IS NULL
          AND (ti."completionCriteria"->>'assessmentMode')::boolean IS TRUE
          AND ti."completionCriteria"->>'assessmentPhase' IN ('PRE', 'POST')
          AND ti."completionCriteria"->>'assessmentPairKey' IS NOT NULL`,
      [trackId, tenantId],
    );
    const byKey = new Map<string, { pre?: PairItemRow; post?: PairItemRow }>();
    for (const item of items) {
      const pair = byKey.get(item.pairKey) ?? {};
      if (item.phase === 'PRE') pair.pre = item;
      else pair.post = item;
      byKey.set(item.pairKey, pair);
    }
    const complete = Array.from(byKey.entries()).filter(
      (entry): entry is [string, { pre: PairItemRow; post: PairItemRow }] =>
        !!entry[1].pre && !!entry[1].post,
    );
    if (complete.length === 0) return { trackId, pairs: [] };

    const itemIds = complete.flatMap(([, pair]) => [pair.pre.id, pair.post.id]);
    const progress: ProgressRow[] = await this.dataSource.query(
      `SELECT tip."trackItemId", te."userId", u.name, tip.score, tip.meta
         FROM track_item_progress tip
         JOIN track_enrollments te ON te.id = tip."trackEnrollmentId"
         LEFT JOIN users u ON u.id = te."userId"
        WHERE tip."trackItemId" = ANY($1::uuid[])
          AND te."tenantId"::text = $2
          AND te."deletedAt" IS NULL`,
      [itemIds, tenantId],
    );

    const pairs: AssessmentPairReport[] = [];
    for (const [pairKey, pair] of complete) {
      const learners = new Map<number, AssessmentPairLearner>();
      for (const row of progress) {
        const phase =
          row.trackItemId === pair.pre.id
            ? 'pre'
            : row.trackItemId === pair.post.id
              ? 'post'
              : null;
        if (!phase) continue;
        const learner = learners.get(row.userId) ?? {
          userId: row.userId,
          name: row.name ?? null,
          pre: null,
          post: null,
          gain: null,
        };
        learner[phase] = summarise(row);
        learners.set(row.userId, learner);
      }
      const rows = Array.from(learners.values()).filter(
        (l) =>
          (l.pre && l.pre.submittedAt) ||
          (l.post && l.post.submittedAt) ||
          (l.pre?.incompleteStarts ?? 0) > 0 ||
          (l.post?.incompleteStarts ?? 0) > 0,
      );
      for (const learner of rows) {
        if (learner.pre?.score != null && learner.post?.score != null) {
          learner.gain = round1(learner.post.score - learner.pre.score);
        }
      }
      rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

      const paired = rows.filter((l) => l.gain !== null);
      const suppressed = paired.length < ASSESSMENT_COHORT_MIN_GROUP_SIZE;
      const avg = (values: number[]) => {
        const m = mean(values);
        return suppressed || m === null ? null : round1(m);
      };
      pairs.push({
        pairKey,
        preItem: {
          id: pair.pre.id,
          title: pair.pre.title,
          scenarioId: pair.pre.scenarioId,
        },
        postItem: {
          id: pair.post.id,
          title: pair.post.title,
          scenarioId: pair.post.scenarioId,
        },
        comparability: await compareScenarioBehaviours(
          this.dataSource,
          pair.pre.scenarioId,
          pair.post.scenarioId,
        ),
        learners: rows,
        cohort: {
          n: paired.length,
          avgPre: avg(paired.map((l) => l.pre!.score!)),
          avgPost: avg(paired.map((l) => l.post!.score!)),
          avgGain: avg(paired.map((l) => l.gain!)),
          suppressed,
          minGroupSize: ASSESSMENT_COHORT_MIN_GROUP_SIZE,
        },
      });
    }
    return { trackId, pairs };
  }
}

function summarise(row: ProgressRow): AssessmentAttemptSummary {
  const meta = row.meta ?? {};
  const submission = meta.assessmentSubmission;
  // The frozen submission wins; an attempt from before it existed falls back
  // to the score kept on the progress row when it was submitted.
  const rawScore =
    submission && typeof submission.score === 'number'
      ? submission.score
      : meta.assessmentSubmittedAt && row.score !== null
        ? Number(row.score)
        : null;
  return {
    score: rawScore === null || Number.isNaN(rawScore) ? null : rawScore,
    submittedAt: submission?.submittedAt ?? meta.assessmentSubmittedAt ?? null,
    incompleteStarts: meta.assessmentIncompleteStarts ?? 0,
    reopened: !!meta.assessmentReopenedAt,
  };
}
