import { DebriefCards, renderCards } from './debrief-cards.util';

/**
 * The nightly check (v9 FR-49, plan §11.3; release-2 plan P3): what one day of
 * live debriefs looked like, and what drifted against the days before.
 *
 * Every measure works the same in any language and script: words are counted
 * by whitespace, sameness compares character trigrams, and vagueness is the
 * independent judge's own evidence-specificity score, so no word list is
 * needed for any language.
 */

/** One live run as the nightly check reads it. */
export interface NightlyRun {
  id: string;
  learnerId: number | null;
  language: string | null;
  recipeKey: string | null;
  status: string;
  cards: DebriefCards | null;
  evaluatorOverall: number | null;
  judgeOverall: number | null;
  /** The judge's evidence_specificity score, 0–10. */
  judgeSpecificity: number | null;
}

export interface NightlyMetrics {
  runs: number;
  /** Words per published debrief. */
  wordsP50: number | null;
  wordsP90: number | null;
  /** Quotes from the transcript per debrief. */
  quotesPerDebrief: number | null;
  /**
   * 0–1: how alike each debrief's lead lines are to another learner's, on
   * average (character trigrams, so any script). Rising = debriefs read the same.
   */
  sameness: number | null;
  /** Mean of the judge's evidence_specificity (0–10). Falling = vaguer. */
  specificity: number | null;
  /** Mean of Evaluator overall − judge overall, on runs with both. */
  evaluatorJudgeGap: number | null;
}

export interface NightlyThresholds {
  /** Alert when words p50 rises by more than this share over the baseline. */
  lengthCreepShare: number;
  /** Alert when sameness is above this. */
  samenessMax: number;
  /** Alert when the judge's specificity falls by more than this many points. */
  specificityDrop: number;
  /** Alert when the Evaluator sits this many points above the judge, or more. */
  gapMax: number;
}

export type NightlyAlertCode =
  | 'length_creep'
  | 'sameness'
  | 'vaguer'
  | 'evaluator_judge_gap'
  | 'judge_drift';

export interface NightlyAlert {
  code: NightlyAlertCode;
  /** What was seen, in words, for the Analytics alert list and the PM agent. */
  detail: string;
  value: number;
  baseline: number | null;
}

/** Fewer published debriefs than this in a slice: no alerts, too few to tell. */
export const NIGHTLY_MIN_RUNS = 5;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[i];
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function wordCount(text: string): number {
  return (text ?? '').trim().split(/\s+/u).filter(Boolean).length;
}

/** Every transcript quote a debrief carries. */
export function quotesOf(cards: DebriefCards): number {
  let n = 0;
  if (cards.important_moment?.quote) n += 1;
  n += (cards.important_moment?.others ?? []).filter((o) => o.quote).length;
  n += (cards.what_worked ?? []).filter((c) => c.quote).length;
  n += (cards.work_on_this ?? []).filter((c) => c.quote).length;
  return n;
}

/** The lines that say what this debrief is about: lead lines and try-saying lines. */
export function leadLines(cards: DebriefCards): string[] {
  return [
    cards.important_moment?.lead,
    ...(cards.what_worked ?? []).map((c) => c.lead),
    ...(cards.work_on_this ?? []).flatMap((c) => [c.lead, c.try_saying]),
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.toLowerCase().normalize('NFKC'));
}

/** Character trigrams of a text, spaces folded: works for any script. */
export function trigrams(text: string): Set<string> {
  const t = ` ${text.replace(/\s+/gu, ' ').trim()} `;
  const chars = Array.from(t);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= chars.length; i++)
    out.add(chars.slice(i, i + 3).join(''));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  return both / (a.size + b.size - both);
}

/**
 * Sameness across learners: for each debrief, how close its lead lines come
 * to the closest debrief of ANOTHER learner (their trigram Jaccard), averaged.
 * Debriefs for one learner are allowed to resemble each other.
 */
export function sameness(
  debriefs: Array<{ learnerId: number | null; lines: string[] }>,
): number | null {
  const items = debriefs
    .filter((d) => d.lines.length)
    .map((d) => ({
      learnerId: d.learnerId,
      grams: trigrams(d.lines.join(' ')),
    }));
  const learners = new Set(items.map((i) => i.learnerId));
  if (items.length < 2 || learners.size < 2) return null;
  const closest = items.map((a) => {
    let best = 0;
    for (const b of items) {
      if (b === a || b.learnerId === a.learnerId) continue;
      best = Math.max(best, jaccard(a.grams, b.grams));
    }
    return best;
  });
  return round(mean(closest) ?? 0, 3);
}

/** The day's measures for a set of runs (one slice). */
export function nightlyMetrics(
  runs: NightlyRun[],
  weekForSameness: NightlyRun[] = runs,
): NightlyMetrics {
  const published = runs.filter(
    (r) => r.cards && ['published', 'below_bar'].includes(r.status),
  );
  const words = published.map((r) => wordCount(renderCards(r.cards!)));
  const quotes = published.map((r) => quotesOf(r.cards!));
  const spec = runs
    .map((r) => r.judgeSpecificity)
    .filter((v): v is number => typeof v === 'number');
  const gaps = runs
    .filter(
      (r) =>
        typeof r.evaluatorOverall === 'number' &&
        typeof r.judgeOverall === 'number',
    )
    .map((r) => (r.evaluatorOverall as number) - (r.judgeOverall as number));
  const sp = mean(spec);
  const gap = mean(gaps);
  const q = mean(quotes);
  return {
    runs: runs.length,
    wordsP50: percentile(words, 0.5),
    wordsP90: percentile(words, 0.9),
    quotesPerDebrief: q == null ? null : round(q),
    sameness: sameness(
      weekForSameness
        .filter((r) => r.cards)
        .map((r) => ({ learnerId: r.learnerId, lines: leadLines(r.cards!) })),
    ),
    specificity: sp == null ? null : round(sp),
    evaluatorJudgeGap: gap == null ? null : round(gap),
  };
}

/** The baseline a day is compared with: the median of each measure over the days before. */
export function baselineOf(days: NightlyMetrics[]): Partial<NightlyMetrics> {
  const med = (k: keyof NightlyMetrics) =>
    percentile(
      days.map((d) => d[k]).filter((v): v is number => typeof v === 'number'),
      0.5,
    );
  return {
    wordsP50: med('wordsP50'),
    sameness: med('sameness'),
    specificity: med('specificity'),
    evaluatorJudgeGap: med('evaluatorJudgeGap'),
  };
}

/** What drifted today against the baseline, by the owner's thresholds. */
export function nightlyAlerts(
  today: NightlyMetrics,
  baseline: Partial<NightlyMetrics>,
  t: NightlyThresholds,
): NightlyAlert[] {
  if (today.runs < NIGHTLY_MIN_RUNS) return [];
  const out: NightlyAlert[] = [];
  if (
    today.wordsP50 != null &&
    baseline.wordsP50 != null &&
    today.wordsP50 > baseline.wordsP50 * (1 + t.lengthCreepShare)
  ) {
    out.push({
      code: 'length_creep',
      detail: `Debriefs are longer: ${today.wordsP50} words at the median, against ${baseline.wordsP50} before.`,
      value: today.wordsP50,
      baseline: baseline.wordsP50,
    });
  }
  if (today.sameness != null && today.sameness > t.samenessMax) {
    out.push({
      code: 'sameness',
      detail: `Debriefs for different learners read alike: sameness ${today.sameness} (alert above ${t.samenessMax}).`,
      value: today.sameness,
      baseline: baseline.sameness ?? null,
    });
  }
  if (
    today.specificity != null &&
    baseline.specificity != null &&
    today.specificity < baseline.specificity - t.specificityDrop
  ) {
    out.push({
      code: 'vaguer',
      detail: `Debriefs are vaguer: the independent check scored specificity ${today.specificity}, against ${baseline.specificity} before.`,
      value: today.specificity,
      baseline: baseline.specificity,
    });
  }
  if (today.evaluatorJudgeGap != null && today.evaluatorJudgeGap >= t.gapMax) {
    out.push({
      code: 'evaluator_judge_gap',
      detail: `Ally's own check scores ${today.evaluatorJudgeGap} points above the independent check on average.`,
      value: today.evaluatorJudgeGap,
      baseline: baseline.evaluatorJudgeGap ?? null,
    });
  }
  return out;
}

/**
 * Judge drift on the anchor set: the mean of (score now − first score) over
 * debriefs judged again. Null below 10 re-scored debriefs.
 */
export function judgeDrift(
  pairs: Array<{ before: number; after: number }>,
): { drift: number; n: number } | null {
  if (pairs.length < 10) return null;
  return {
    drift: round(mean(pairs.map((p) => p.after - p.before)) ?? 0),
    n: pairs.length,
  };
}
