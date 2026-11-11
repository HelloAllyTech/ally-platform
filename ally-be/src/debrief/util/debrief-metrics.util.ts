/**
 * The debrief's success metrics (v9 §3.3, PRD §4), computed in code from
 * counts the metrics service reads. Every rate keeps its denominator so the
 * Console can say "not enough data" instead of showing a noisy percentage.
 */

/**
 * A rate with the counts behind it; `value` is null when nothing was counted.
 * `low`/`high` are its 95% Wilson interval — every rate the Console shows
 * carries one, because a rate without its interval reads as more certain than
 * it is (Wilson rather than ±1.96·SE, which breaks on small n and near 0/1).
 */
export interface Rate {
  value: number | null;
  n: number;
  of: number;
  low: number | null;
  high: number | null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** 95% Wilson score interval for n successes out of `of`. */
export function wilson(
  n: number,
  of: number,
  z = 1.96,
): { low: number | null; high: number | null } {
  if (of <= 0) return { low: null, high: null };
  const p = n / of;
  const z2 = z * z;
  const centre = (p + z2 / (2 * of)) / (1 + z2 / of);
  const half =
    (z * Math.sqrt((p * (1 - p)) / of + z2 / (4 * of * of))) / (1 + z2 / of);
  return {
    low: round3(Math.max(0, centre - half)),
    high: round3(Math.min(1, centre + half)),
  };
}

export const rate = (n: number, of: number): Rate => ({
  value: of > 0 ? round3(n / of) : null,
  n,
  of,
  ...wilson(n, of),
});

/**
 * Two versions on the same cases: the difference in pass rate (b − a), its 95%
 * interval for paired proportions, and how many cases got better and worse —
 * "same pass rate" can hide as many regressions as improvements. An interval
 * that includes zero is no measurable difference.
 */
export interface PairedDifference {
  n: number;
  better: number;
  worse: number;
  diff: number | null;
  low: number | null;
  high: number | null;
  /**
   * Exact two-sided McNemar p on the discordant cases. With few of them the
   * interval can sit off zero while p is still large: read both, and trust
   * neither alone below ~10 discordant cases.
   */
  mcnemarP: number | null;
}

/** Two-sided exact binomial test of k successes in m trials at p = 0.5. */
function exactMcNemar(better: number, worse: number): number | null {
  const m = better + worse;
  if (m === 0) return null;
  const k = Math.min(better, worse);
  let tail = 0;
  let c = 1; // C(m, 0)
  for (let i = 0; i <= k; i++) {
    if (i > 0) c = (c * (m - i + 1)) / i;
    tail += c;
  }
  return round3(Math.min(1, (2 * tail) / 2 ** m));
}

export function pairedDifference(
  pairs: Array<{ a: boolean; b: boolean }>,
  z = 1.96,
): PairedDifference {
  const n = pairs.length;
  const better = pairs.filter((p) => !p.a && p.b).length;
  const worse = pairs.filter((p) => p.a && !p.b).length;
  if (n === 0) {
    return {
      n,
      better,
      worse,
      diff: null,
      low: null,
      high: null,
      mcnemarP: null,
    };
  }
  const diff = (better - worse) / n;
  const se =
    Math.sqrt(Math.max(0, better + worse - (better - worse) ** 2 / n)) / n;
  return {
    n,
    better,
    worse,
    diff: round3(diff),
    low: round3(Math.max(-1, diff - z * se)),
    high: round3(Math.min(1, diff + z * se)),
    mcnemarP: exactMcNemar(better, worse),
  };
}

/** Session length by learner turns: the bands the test sets are stratified by, and the Console cuts by. */
export function lengthBand(learnerTurns: number): string {
  if (learnerTurns < 6) return '1-5';
  if (learnerTurns <= 15) return '6-15';
  if (learnerTurns <= 30) return '16-30';
  return '31+';
}

/** Below this many in the denominator a rate is shown but marked thin. */
export const MIN_RATE_SAMPLE = 20;

export interface SteeringWeights {
  judge: number;
  practise: number;
  thumbs: number;
}

export interface SteeringScore {
  /** 0–100, or null when there is no judge score that week. */
  value: number | null;
  /** Components that had no data that week; the rest are re-weighted. */
  missing: Array<'practise' | 'thumbs'>;
  components: {
    judge: number | null;
    practise: Rate;
    thumbs: Rate;
  };
}

/**
 * The weekly steering proxy (v9 §3.3, Q2): independent judge 50% + "Practise
 * this next" click-through 25% + thumbs-up rate 25%, as 0–100. The judge is
 * required; a click-through or thumbs component with nothing counted is left
 * out and the remaining weights re-normalised, and the week says so.
 */
export function steeringScore(
  judgeMean: number | null,
  practise: Rate,
  thumbs: Rate,
  w: SteeringWeights,
): SteeringScore {
  const components = { judge: judgeMean, practise, thumbs };
  if (judgeMean == null) {
    return { value: null, missing: [], components };
  }
  const parts: Array<[number, number]> = [[w.judge, judgeMean / 10]];
  const missing: SteeringScore['missing'] = [];
  if (practise.value == null) missing.push('practise');
  else parts.push([w.practise, practise.value]);
  if (thumbs.value == null) missing.push('thumbs');
  else parts.push([w.thumbs, thumbs.value]);
  const total = parts.reduce((a, [wt]) => a + wt, 0);
  if (total <= 0) return { value: null, missing, components };
  const value = parts.reduce((a, [wt, v]) => a + wt * v, 0) / total;
  return {
    value: Math.round(value * 1000) / 10,
    missing,
    components,
  };
}

/** How a metric stands against its v9 target. */
export type TargetState = 'met' | 'missed' | 'thin' | 'no_data';

export function targetState(
  value: number | null,
  target: { atLeast?: number; atMost?: number },
  sample?: number,
): TargetState {
  if (value == null) return 'no_data';
  if (sample != null && sample < MIN_RATE_SAMPLE) return 'thin';
  if (target.atLeast != null && value < target.atLeast) return 'missed';
  if (target.atMost != null && value > target.atMost) return 'missed';
  return 'met';
}

// --- Uptake lift (the north star) ------------------------------------------------

export type Observation = 'observed' | 'partial' | 'missed';
const SCORE: Record<Observation, number> = {
  observed: 1,
  partial: 0.5,
  missed: 0,
};

export interface UptakeRun {
  learnerId: number;
  at: Date;
  behaviours: Array<{
    skill: string;
    opportunity: boolean;
    observation: Observation;
  }>;
  /** The skills the debrief told the learner to work on. */
  targeted: string[];
}

/** Skills are free text from the Analyst: compare them lower-cased, without punctuation. */
export const skillKey = (s: string): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();

export const UPTAKE_WINDOW_DAYS = 14;
export const UPTAKE_MIN_PAIRS = 150;

export interface UptakeResult {
  pairs: number;
  /** Mean of (targeted change − matched untargeted change); null below the minimum. */
  lift: number | null;
  lower: number | null;
  upper: number | null;
  insufficient: boolean;
}

/**
 * v9 §3.3 north star. For each "Work on this" skill in debrief n, its change
 * in the learner's next debriefed session within 14 days, minus the mean
 * change of the untargeted skills matched to it: same learner, the same score
 * in session n (our stand-in for "prior estimate within ±0.10", since no
 * skill-estimate store exists), and an opportunity in both sessions. Change
 * uses observed = 1, partial = 0.5, missed = 0. Below 150 pairs the result is
 * "insufficient data".
 */
export function uptakeLift(runs: UptakeRun[]): UptakeResult {
  const byLearner = new Map<number, UptakeRun[]>();
  for (const r of runs) {
    const list = byLearner.get(r.learnerId) ?? [];
    list.push(r);
    byLearner.set(r.learnerId, list);
  }
  const diffs: number[] = [];
  for (const list of byLearner.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i + 1 < list.length; i++) {
      const n = list[i];
      const m = list[i + 1];
      const days = (m.at.getTime() - n.at.getTime()) / 86_400_000;
      if (days > UPTAKE_WINDOW_DAYS) continue;
      const before = scored(n);
      const after = scored(m);
      const targeted = new Set(n.targeted.map(skillKey));
      const change = (k: string) =>
        before.has(k) && after.has(k)
          ? (after.get(k) as number) - (before.get(k) as number)
          : null;
      for (const t of targeted) {
        const own = change(t);
        if (own == null) continue;
        const prior = before.get(t) as number;
        const controls = [...before.keys()]
          .filter((k) => !targeted.has(k) && before.get(k) === prior)
          .map(change)
          .filter((c): c is number => c != null);
        if (!controls.length) continue;
        diffs.push(own - controls.reduce((a, b) => a + b, 0) / controls.length);
      }
    }
  }
  const pairs = diffs.length;
  if (pairs < UPTAKE_MIN_PAIRS) {
    return { pairs, lift: null, lower: null, upper: null, insufficient: true };
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / pairs;
  const sd = Math.sqrt(
    diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (pairs - 1),
  );
  const half = (1.96 * sd) / Math.sqrt(pairs);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    pairs,
    lift: r3(mean),
    lower: r3(mean - half),
    upper: r3(mean + half),
    insufficient: false,
  };
}

/** A run's skills that had an opportunity, keyed, with their score. */
function scored(r: UptakeRun): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of r.behaviours ?? []) {
    if (!b?.opportunity || !(b.observation in SCORE)) continue;
    out.set(skillKey(b.skill), SCORE[b.observation]);
  }
  return out;
}
