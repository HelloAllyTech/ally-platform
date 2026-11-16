/**
 * The cumulative score (Debrief v2, S1–S2), beside the weekly steering proxy
 * in debrief-metrics.util.ts whose weights it replaces: what the system works
 * from (Analytics' quality score, the PM agent's target and the undo watch).
 * Pure: the services read the rows, these decide.
 */

/** The four measures the cumulative score is made of. */
export const SCORE_MEASURES = ['quality', 'pass', 'helpful', 'flags'] as const;
export type ScoreMeasure = (typeof SCORE_MEASURES)[number];

/** Owner settings `scoreWeightQuality` … `scoreWeightFlags`. */
export type ScoreWeights = Record<ScoreMeasure, number>;

/** The measures in the owner's words. */
export const SCORE_MEASURE_LABELS: Record<ScoreMeasure, string> = {
  quality: 'Quality score',
  pass: 'Pass rate',
  helpful: 'Learners who found it helpful',
  flags: 'Cards flagged by learners',
};

/**
 * One slice's facts as the score reads them. A measure without data is null:
 * a run nobody rated has no `helpful`, a run not judged yet no `quality`.
 */
export interface ScoreFacts {
  /** The judge's overall, 0–10 (mean). */
  quality: number | null;
  /** The share (0–1) that passed (debriefOutcome). */
  pass: number | null;
  /** The share (0–1) of ratings that said helpful. */
  helpful: number | null;
  /** The share (0–1) of debriefs with a card flagged by the learner (lower is better). */
  flags: number | null;
}

/**
 * The cumulative score, 0–10 with one decimal place: quality 40%, pass rate
 * 25%, learner helpful rate 20%, card flag rate 15% (counted as 1 − rate).
 * The weights are owner settings. A measure without data is left out and the
 * rest re-weighted; without a quality score there is no score (a missing
 * judge score is not a low one).
 */
export function cumulativeScore(f: ScoreFacts, w: ScoreWeights): number | null {
  if (f.quality == null) return null;
  const parts: Array<[number, number]> = [[w.quality, f.quality / 10]];
  if (f.pass != null) parts.push([w.pass, f.pass]);
  if (f.helpful != null) parts.push([w.helpful, f.helpful]);
  if (f.flags != null) parts.push([w.flags, 1 - f.flags]);
  const total = parts.reduce((a, [wt]) => a + Math.max(0, wt), 0);
  if (total <= 0) return null;
  const v = parts.reduce((a, [wt, x]) => a + Math.max(0, wt) * x, 0) / total;
  return Math.round(v * 100) / 10;
}

/** A run as the score counts it. */
export interface ScoreRun {
  /** The judge's overall, 0–10, or null when not judged yet. */
  quality: number | null;
  /** debriefOutcome().pass: null is out of the denominator. */
  pass: boolean | null;
  /** The learner's rating: true helpful, false not, null not rated. */
  helpful: boolean | null;
  /** A learner flagged a card (not withdrawn). */
  flagged: boolean;
}

/** One run's score (S1 "per run"). */
export function runScore(r: ScoreRun, w: ScoreWeights): number | null {
  return cumulativeScore(
    {
      quality: r.quality,
      pass: r.pass == null ? null : r.pass ? 1 : 0,
      helpful: r.helpful == null ? null : r.helpful ? 1 : 0,
      flags: r.flagged ? 1 : 0,
    },
    w,
  );
}

/** A slice's facts (week × language × recipe × release): means and shares of its runs. */
export function sliceFacts(runs: ScoreRun[]): ScoreFacts & { n: number } {
  const q = runs.map((r) => r.quality).filter((x): x is number => x != null);
  const p = runs.map((r) => r.pass).filter((x): x is boolean => x != null);
  const h = runs.map((r) => r.helpful).filter((x): x is boolean => x != null);
  return {
    n: runs.length,
    quality: q.length ? q.reduce((a, b) => a + b, 0) / q.length : null,
    pass: p.length ? p.filter(Boolean).length / p.length : null,
    helpful: h.length ? h.filter(Boolean).length / h.length : null,
    flags: runs.length
      ? runs.filter((r) => r.flagged).length / runs.length
      : null,
  };
}

/** A slice's score from its runs (S1 "per slice"). */
export function sliceScore(runs: ScoreRun[], w: ScoreWeights): number | null {
  return cumulativeScore(sliceFacts(runs), w);
}

/** The owner's weights from the settings. */
export function scoreWeightsOf(s: {
  scoreWeightQuality: number;
  scoreWeightPass: number;
  scoreWeightHelpful: number;
  scoreWeightFlags: number;
}): ScoreWeights {
  return {
    quality: s.scoreWeightQuality,
    pass: s.scoreWeightPass,
    helpful: s.scoreWeightHelpful,
    flags: s.scoreWeightFlags,
  };
}

/** A run as the two gates read it (S2). */
export interface GateRun {
  /** Shown to the learner with a missed clear risk cue (`workspace.decision.reviewReason`). */
  missedClearRiskCue: boolean;
  /** What the session cost: the debrief and every Ask Ally reply, USD. */
  sessionCostUsd: number | null;
}

export interface ScoreGates {
  risk: { ok: boolean; missed: number; before: number };
  cost: {
    ok: boolean;
    /** The 90th percentile of what a session cost. */
    p90Usd: number | null;
    budgetUsd: number;
    over: number;
  };
}

/**
 * The two gates, never traded against the score (S2): no new missed clear
 * risk cue (one is "new" when the comparison had none; with no comparison,
 * any is new), and what a session costs within the session budget (its 90th
 * percentile).
 */
export function scoreGates(
  runs: GateRun[],
  before: GateRun[] | null,
  sessionBudgetUsd: number,
): ScoreGates {
  const missed = runs.filter((r) => r.missedClearRiskCue).length;
  const was = before ? before.filter((r) => r.missedClearRiskCue).length : 0;
  const costs = runs
    .map((r) => r.sessionCostUsd)
    .filter((c): c is number => c != null && Number.isFinite(c))
    .sort((a, b) => a - b);
  const p90 = costs.length
    ? costs[Math.min(costs.length - 1, Math.ceil(costs.length * 0.9) - 1)]
    : null;
  return {
    risk: { ok: missed === 0 || was > 0, missed, before: was },
    cost: {
      ok: p90 == null || p90 <= sessionBudgetUsd + 1e-9,
      p90Usd: p90 == null ? null : Math.round(p90 * 10_000) / 10_000,
      budgetUsd: sessionBudgetUsd,
      over: costs.filter((c) => c > sessionBudgetUsd + 1e-9).length,
    },
  };
}

/** Fewer debriefs than this on either side of a comparison: the score alone never undoes. */
export const UNDO_MIN_RUNS = 30;

export interface WatchSlice {
  language: string;
  recipe: string;
  after: ScoreRun[];
  before: ScoreRun[];
}

export interface UndoDecision {
  undo: boolean;
  /** The plain-English reason, or why it is still being watched. */
  reason: string;
  /** The slice that fell furthest past the margin. */
  worst: {
    language: string;
    recipe: string;
    after: number;
    before: number;
    n: number;
  } | null;
}

/**
 * Watching a change after it went live for everyone (A5): undo when, within
 * one language and recipe with at least `minRuns` debriefs on each side, its
 * score is lower than the release before by more than `margin`; or when a
 * gate trips. Never compares across languages or recipes.
 */
export function undoDecision(
  slices: WatchSlice[],
  gates: ScoreGates,
  w: ScoreWeights,
  margin: number,
  minRuns = UNDO_MIN_RUNS,
): UndoDecision {
  if (!gates.risk.ok) {
    return {
      undo: true,
      reason: `${gates.risk.missed} debrief${gates.risk.missed === 1 ? ' was' : 's were'} shown with a missed clear risk cue; the release before had none`,
      worst: null,
    };
  }
  if (!gates.cost.ok) {
    return {
      undo: true,
      reason: `sessions cost $${(gates.cost.p90Usd ?? 0).toFixed(2)} (90th percentile), over the $${gates.cost.budgetUsd.toFixed(2)} session budget`,
      worst: null,
    };
  }
  let worst: UndoDecision['worst'] = null;
  let compared = 0;
  for (const s of slices) {
    if (s.after.length < minRuns || s.before.length < minRuns) continue;
    const a = sliceScore(s.after, w);
    const b = sliceScore(s.before, w);
    if (a == null || b == null) continue;
    compared++;
    if (b - a > margin && (!worst || b - a > worst.before - worst.after)) {
      worst = {
        language: s.language,
        recipe: s.recipe,
        after: a,
        before: b,
        n: s.after.length,
      };
    }
  }
  if (worst) {
    return {
      undo: true,
      reason: `the score fell from ${worst.before.toFixed(1)} to ${worst.after.toFixed(1)} in ${languageName(worst.language)} (${worst.recipe}) over ${worst.n} debriefs`,
      worst,
    };
  }
  return {
    undo: false,
    reason: compared
      ? 'no language has fallen past the undo margin'
      : `fewer than ${minRuns} debriefs in any one language on each side yet`,
    worst: null,
  };
}

/** A trend between two values in words, and its tone (`higherIsBetter` decides up/down). */
export function trendOf(
  now: number | null,
  before: number | null,
  higherIsBetter = true,
  epsilon = 0.05,
): { trend: string; tone: 'up' | 'down' | 'flat' } {
  if (now == null || before == null)
    return { trend: 'no comparison yet', tone: 'flat' };
  const d = now - before;
  if (Math.abs(d) < epsilon) return { trend: 'about the same', tone: 'flat' };
  const better = higherIsBetter ? d > 0 : d < 0;
  return {
    trend: `${d > 0 ? 'up' : 'down'} from ${round1(before)}`,
    tone: better ? 'up' : 'down',
  };
}

export const round1 = (x: number) => (Math.round(x * 10) / 10).toString();

const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  kn: 'Kannada',
  mr: 'Marathi',
  ta: 'Tamil',
  te: 'Telugu',
  bn: 'Bengali',
  ml: 'Malayalam',
  gu: 'Gujarati',
};

/** A language code in words ("unknown" when not recorded). */
export function languageName(code: string | null | undefined): string {
  if (!code || code === 'unknown') return 'an unrecorded language';
  return LANGUAGES[code] ?? code;
}
