import { createHash } from 'crypto';
import {
  ClChunkConfidence,
  ClChunkOrigin,
  ClJudgmentSplit,
  ClLoopActionType,
} from '../enum/context-library.enum';

/**
 * The learning loops' arithmetic, kept pure so every threshold is testable on its own. The
 * services around it only fetch rows and write actions.
 */

/** One in five query wordings goes to the holdout, decided by hash so it never moves. */
export function splitForQuery(queries: readonly string[]): ClJudgmentSplit {
  const key = queries
    .map((q) => q.trim().toLowerCase())
    .sort()
    .join('\n');
  const byte = createHash('sha256').update(key).digest()[0];
  return byte % 5 === 0 ? ClJudgmentSplit.HOLDOUT : ClJudgmentSplit.LEARN;
}

/**
 * The platform judge labels relevance in words; the benchmark needs grades. A relevant passage
 * retrieved only for its vocabulary is still relevant, but it is the kind of hit the next
 * wording will miss, so it scores one lower.
 */
export function gradeFromJudge(
  relevance: string,
  superficialMatch: boolean,
): number {
  if (relevance === 'relevant') return superficialMatch ? 2 : 3;
  if (relevance === 'tangential') return 1;
  return 0;
}

/** nDCG@k of one ranked list against judged grades; unjudged items count as 0. */
export function ndcgAt(
  ranked: readonly string[],
  grades: ReadonlyMap<string, number>,
  k: number,
): number {
  const gain = (g: number) => Math.pow(2, g) - 1;
  const dcg = ranked
    .slice(0, k)
    .reduce(
      (sum, id, i) => sum + gain(grades.get(id) ?? 0) / Math.log2(i + 2),
      0,
    );
  const ideal = [...grades.values()]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, g, i) => sum + gain(g) / Math.log2(i + 2), 0);
  return ideal > 0 ? dcg / ideal : 0;
}

/** Share of the judged-useful items (grade ≥ 2) that appear in the first k candidates. */
export function recallAt(
  candidates: readonly string[],
  grades: ReadonlyMap<string, number>,
  k: number,
): number | null {
  const useful = [...grades.entries()]
    .filter(([, g]) => g >= 2)
    .map(([id]) => id);
  if (!useful.length) return null;
  const top = new Set(candidates.slice(0, k));
  return useful.filter((id) => top.has(id)).length / useful.length;
}

export function mean(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

/**
 * How much attention a position gets. Position 1 is seen almost always and position 8 far
 * less, so a chunk shown at 8 and not used is weaker evidence against it than one shown at 1.
 */
export function positionWeight(rank: number | null | undefined): number {
  const r = rank && rank > 0 ? rank : 8;
  return 1 / Math.log2(r + 1);
}

/** Usage events and how much each counts as "this chunk helped". */
export const USE_WEIGHTS: Record<string, number> = {
  applied_verified: 1,
  agent_applied: 1,
  shipped: 1,
  cited: 0.5,
  probed: 0.4,
  read: 0.25,
  not_relevant: -0.5,
  agent_contradicted: -1,
  cite_rejected: 0,
};

/** Smoothing: with no evidence a chunk sits at the prior, and a few uses can't swing it far. */
export const EFFECTIVENESS_PRIOR = 0.3;
export const EFFECTIVENESS_STRENGTH = 5;

/**
 * Position-corrected, smoothed use rate in 0–1. `exposure` is the sum of position weights of
 * every surfacing; `uses` the weighted sum of what happened after.
 */
export function effectivenessScore(uses: number, exposure: number): number {
  const raw =
    (Math.max(uses, 0) + EFFECTIVENESS_PRIOR * EFFECTIVENESS_STRENGTH) /
    (Math.max(exposure, 0) + EFFECTIVENESS_STRENGTH);
  return Math.min(1, Math.max(0, raw));
}

export interface CuratorStats {
  origin: ClChunkOrigin;
  confidence: ClChunkConfidence;
  pinned: boolean;
  surfaced: number;
  judged: number;
  /** Judgments of 0 or 1. */
  judgedOffTopic: number;
  /** Judgments of 2 or 3. */
  judgedUseful: number;
  applied: number;
  cited: number;
}

export const CURATOR_MIN_SURFACED = 30;
export const CURATOR_OFF_TOPIC_SHARE = 0.6;
export const CURATOR_MIN_JUDGED = 5;
export const CURATOR_PROMOTE_APPLIED = 2;

/**
 * The curator's rule for one distilled chunk. Authored, imported and synced chunks belong to
 * their author or source table: the curator never archives or demotes them — it only reports
 * them. Pinned chunks are never touched.
 */
export function curatorDecision(
  s: CuratorStats,
): { action: ClLoopActionType; reason: string } | null {
  if (s.pinned || s.origin !== ClChunkOrigin.DISTILLED) return null;
  const share = s.judged ? s.judgedOffTopic / s.judged : 0;
  if (
    s.surfaced >= CURATOR_MIN_SURFACED &&
    s.judged >= CURATOR_MIN_JUDGED &&
    share >= CURATOR_OFF_TOPIC_SHARE &&
    s.applied === 0
  ) {
    return {
      action: ClLoopActionType.ARCHIVE,
      reason: `Never useful: shown ${s.surfaced} times, judged off-topic in ${Math.round(share * 100)}% of ${s.judged} checks, never applied`,
    };
  }
  if (
    s.confidence === ClChunkConfidence.LOW &&
    s.applied >= CURATOR_PROMOTE_APPLIED
  ) {
    return {
      action: ClLoopActionType.PROMOTE,
      reason: `Low confidence but applied ${s.applied} times, so trusted like any other`,
    };
  }
  if (
    s.confidence === ClChunkConfidence.STANDARD &&
    s.surfaced >= CURATOR_MIN_SURFACED &&
    s.judged >= CURATOR_MIN_JUDGED &&
    s.judgedUseful / s.judged >= 0.5 &&
    s.applied === 0 &&
    s.cited === 0
  ) {
    return {
      action: ClLoopActionType.DEMOTE,
      reason: `On topic but never used: shown ${s.surfaced} times without a single citation`,
    };
  }
  return null;
}

/**
 * Authored, imported and synced entries that never help, for their owners to decide about. The
 * loops never change them.
 */
export function neverUseful(s: CuratorStats): boolean {
  if (s.origin === ClChunkOrigin.DISTILLED || s.origin === ClChunkOrigin.AGENT)
    return false;
  return (
    s.surfaced >= CURATOR_MIN_SURFACED &&
    s.applied === 0 &&
    s.cited === 0 &&
    (s.judged < CURATOR_MIN_JUDGED ||
      s.judgedOffTopic / s.judged >= CURATOR_OFF_TOPIC_SHARE)
  );
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Greedy single-pass clustering: each item joins the first cluster whose seed is close enough. */
export function greedyClusters(
  vectors: readonly number[][],
  threshold: number,
): number[][] {
  const clusters: number[][] = [];
  vectors.forEach((v, i) => {
    const home = clusters.find((c) => cosine(vectors[c[0]], v) >= threshold);
    if (home) home.push(i);
    else clusters.push([i]);
  });
  return clusters;
}

/**
 * The tuning guardrail. A challenger replaces the live setup only when it is clearly better on
 * the holdout and finds at least as much.
 */
export const TUNING_MIN_JUDGED_QUERIES = 100;
export const TUNING_MIN_NDCG_GAIN = 0.02;
export const TUNING_MIN_DAYS_BETWEEN = 7;
export const ROLLBACK_PRECISION_DROP = 0.05;
export const ROLLBACK_WINDOW_DAYS = 3;

export function challengerWins(
  live: { ndcg: number; recall: number },
  challenger: { ndcg: number; recall: number },
): boolean {
  return (
    challenger.ndcg >= live.ndcg + TUNING_MIN_NDCG_GAIN &&
    challenger.recall >= live.recall
  );
}

/** Query learning: at most this many learned phrasings per chunk. */
export const MAX_LEARNED_QUERIES = 10;
/** A judged-useful chunk the live search ranked below this was "missed" by that wording. */
export const QUERY_LEARNING_MISSED_RANK = 20;
