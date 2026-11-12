import {
  BINARY_CATEGORIES,
  cohensKappa,
  percentAgreement,
  roundOrNull,
} from '../../analytics/util/rater-agreement.util';
import { DEBRIEF_QUALITY_PASS } from '../../analytics/constants/debrief-quality.constants';
import {
  DebriefAgreementMeasure,
  DebriefCommentTag,
} from '../enum/debrief-review.enum';

/**
 * Judge agreement from the clinical advisor's ordinary reviews (approved by
 * Gopi, 2026-11-12): under the verdict the advisor confirms one yes/no answer
 * per measure the κ gate reads, pre-filled from their own comment tags and
 * hard fails. κ is Cohen's κ between those answers and the independent
 * judge's finding on the same debrief. There is no separate labelling task.
 *
 * The measures are the ones the judge actually emits and the gate reads
 * (`DEBRIEF_GATED_DIMENSIONS` + `DEBRIEF_GATED_HARD_FAILS`): accuracy and
 * evidence_specificity (one 0–10 dimension: the judge scores evidence and
 * specificity together) and the missed_risk_cue hard fail. So three
 * questions, not four. Every question is worded so that Yes is good.
 */
export const AGREEMENT_MEASURES: readonly DebriefAgreementMeasure[] = [
  DebriefAgreementMeasure.ACCURACY,
  DebriefAgreementMeasure.EVIDENCE,
  DebriefAgreementMeasure.MISSED_RISK_CUE,
];

/** A measure counts towards the gate only from this many reviewed debriefs. */
export const AGREEMENT_MIN_REVIEWS = 50;

/** The canary needs κ at least this on every measure. */
export const AGREEMENT_KAPPA = 0.6;

/** A judge's 0–10 score at or above this reads as Yes (the debrief bar, DEBRIEF_QUALITY_PASS). */
export const JUDGE_YES_SCORE = DEBRIEF_QUALITY_PASS;

/** Hard fails that make a debrief inaccurate, for the judge and for the pre-fill. */
const INACCURATE_HARD_FAILS = [
  'fabricated_quote',
  'unsupported_progress_claim',
];

export type AgreementAnswers = Partial<
  Record<DebriefAgreementMeasure, boolean>
>;

export function isAgreementMeasure(v: unknown): v is DebriefAgreementMeasure {
  return AGREEMENT_MEASURES.includes(v as DebriefAgreementMeasure);
}

// --- The judge's finding ------------------------------------------------------------

export interface StoredJudge {
  overall?: number | null;
  dimensions?: Array<{ dimension: string; score: number }>;
  hardFails?: Array<{ code: string } | string>;
}

const codes = (j: StoredJudge): Set<string> =>
  new Set(
    (j.hardFails ?? []).map((h) => (typeof h === 'string' ? h : h?.code)),
  );

const score = (j: StoredJudge, dimension: string): number | null => {
  const hit = j.dimensions?.find((d) => d.dimension === dimension);
  return hit && Number.isFinite(Number(hit.score)) ? Number(hit.score) : null;
};

/**
 * The judge's yes/no on one measure, as the advisor's question asks it; null
 * when the judge gave no reading (then the debrief does not count for it).
 */
export function judgeFinding(
  judge: StoredJudge | null | undefined,
  measure: DebriefAgreementMeasure,
): boolean | null {
  if (!judge) return null;
  switch (measure) {
    case DebriefAgreementMeasure.ACCURACY: {
      const s = score(judge, 'accuracy');
      if (s === null) return null;
      const c = codes(judge);
      return (
        s >= JUDGE_YES_SCORE && !INACCURATE_HARD_FAILS.some((h) => c.has(h))
      );
    }
    case DebriefAgreementMeasure.EVIDENCE: {
      const s = score(judge, 'evidence_specificity');
      return s === null ? null : s >= JUDGE_YES_SCORE;
    }
    case DebriefAgreementMeasure.MISSED_RISK_CUE:
      if (!Array.isArray(judge.hardFails)) return null;
      return !codes(judge).has('missed_risk_cue');
    default:
      return null;
  }
}

// --- The pre-fill -------------------------------------------------------------------

export interface PrefillComment {
  id: string;
  tag: string | null;
  anchorKind: string;
  turnIndex: number | null;
  section: string | null;
  createdAt?: string | Date;
}

/** Where a "No" came from, so the reviewer sees why it is pre-filled. */
export type PrefillSource =
  | {
      kind: 'comment';
      commentId: string;
      anchorKind: string;
      turnIndex: number | null;
      section: string | null;
    }
  | { kind: 'hard_fail'; code: string };

export interface PrefilledAnswer {
  measure: DebriefAgreementMeasure;
  answer: boolean;
  source: PrefillSource | null;
}

const fromComment = (c: PrefillComment): PrefillSource => ({
  kind: 'comment',
  commentId: c.id,
  anchorKind: c.anchorKind,
  turnIndex: c.turnIndex ?? null,
  section: c.section ?? null,
});

/**
 * The answers as they start, from the reviewer's own comments on this debrief
 * (their tags) and the hard fails they ticked. With nothing relevant an
 * answer starts as Yes.
 *
 * - Accuracy: a comment tagged "Wrong or unsupported", or a fabricated quote
 *   or unsupported progress claim ticked → No.
 * - Missed risk cue: the missed risk cue ticked, or a comment tagged "Missed
 *   moment" on a transcript turn where the client voiced a risk → No.
 * - Evidence: no comment tag says "too vague" today, so it starts Yes.
 *
 * A comment wins over a hard fail as the source (it says where); the earliest
 * comment wins among several.
 */
export function prefillAnswers(input: {
  comments: readonly PrefillComment[];
  hardFails: readonly string[];
  riskCueTurns: readonly number[];
}): PrefilledAnswer[] {
  const ordered = [...input.comments].sort(
    (a, b) =>
      new Date(a.createdAt ?? 0).getTime() -
      new Date(b.createdAt ?? 0).getTime(),
  );
  const fails = new Set(input.hardFails);
  const risk = new Set(input.riskCueTurns.map(Number));
  return AGREEMENT_MEASURES.map((measure) => {
    let comment: PrefillComment | undefined;
    let hardFail: string | undefined;
    if (measure === DebriefAgreementMeasure.ACCURACY) {
      comment = ordered.find(
        (c) => c.tag === DebriefCommentTag.WRONG_OR_UNSUPPORTED,
      );
      hardFail = INACCURATE_HARD_FAILS.find((h) => fails.has(h));
    } else if (measure === DebriefAgreementMeasure.MISSED_RISK_CUE) {
      comment = ordered.find(
        (c) =>
          c.tag === DebriefCommentTag.MISSED_MOMENT &&
          c.anchorKind === 'transcript' &&
          c.turnIndex != null &&
          risk.has(Number(c.turnIndex)),
      );
      hardFail = fails.has('missed_risk_cue') ? 'missed_risk_cue' : undefined;
    }
    const source: PrefillSource | null = comment
      ? fromComment(comment)
      : hardFail
        ? { kind: 'hard_fail', code: hardFail }
        : null;
    return { measure, answer: source === null, source };
  });
}

/**
 * The answers as stored: the reviewer's (any not sent keep the pre-fill),
 * with the pre-filled value and whether they changed it.
 */
export function resolveAnswers(
  prefilled: readonly PrefilledAnswer[],
  given: AgreementAnswers | null | undefined,
): Array<PrefilledAnswer & { prefilled: boolean; changed: boolean }> {
  return prefilled.map((p) => {
    const g = given?.[p.measure];
    const answer = typeof g === 'boolean' ? g : p.answer;
    return {
      ...p,
      answer,
      prefilled: p.answer,
      changed: answer !== p.answer,
    };
  });
}

// --- κ ------------------------------------------------------------------------------

/** One debrief's pair on one measure: the advisor's answer (latest verdict) and the judge's. */
export interface AgreementPair {
  runId: string;
  advisor: boolean;
  judge: boolean;
}

export type AgreementState =
  /** Fewer than 50 reviews: "not measured yet, n of 50". */
  | 'not_enough'
  /** 50+ reviews, but both always said the same one thing: κ has no value. */
  | 'undefined'
  | 'below'
  | 'met';

export interface MeasureAgreement {
  measure: DebriefAgreementMeasure;
  /** Debriefs with both an answer and a judge finding. */
  n: number;
  minReviews: number;
  /** Cohen's κ; null below 50 reviews or when it is undefined. */
  kappa: number | null;
  /** Share of debriefs where both said the same; null below 50. */
  agreementPct: number | null;
  /** Of the debriefs the advisor said No to, how many the judge also said No to. */
  recallOnNo: { caught: number; of: number; pct: number | null };
  state: AgreementState;
  passes: boolean;
}

export function measureAgreement(
  measure: DebriefAgreementMeasure,
  pairs: readonly AgreementPair[],
  minReviews = AGREEMENT_MIN_REVIEWS,
): MeasureAgreement {
  // One pair per debrief (the caller passes the latest verdict's).
  const byRun = new Map<string, AgreementPair>();
  for (const p of pairs) byRun.set(p.runId, p);
  const rows = [...byRun.values()];
  const n = rows.length;
  const no = rows.filter((p) => !p.advisor);
  const caught = no.filter((p) => !p.judge).length;
  const recallOnNo = {
    caught,
    of: no.length,
    pct: no.length ? roundOrNull((100 * caught) / no.length, 1) : null,
  };
  if (n < minReviews) {
    return {
      measure,
      n,
      minReviews,
      kappa: null,
      agreementPct: null,
      recallOnNo,
      state: 'not_enough',
      passes: false,
    };
  }
  const tuples = rows.map((p) => [p.advisor ? 1 : 0, p.judge ? 1 : 0] as const);
  const kappa = roundOrNull(cohensKappa(tuples, BINARY_CATEGORIES));
  const passes = kappa !== null && kappa >= AGREEMENT_KAPPA;
  return {
    measure,
    n,
    minReviews,
    kappa,
    agreementPct: roundOrNull(percentAgreement(tuples), 1),
    recallOnNo,
    state: kappa === null ? 'undefined' : passes ? 'met' : 'below',
    passes,
  };
}

export interface AgreementGate {
  met: boolean;
  failing: Array<{ measure: string; kappa: number | null; n: number }>;
}

/** The canary's gate: every measure has 50+ reviews and κ ≥ 0.6. */
export function agreementGate(
  measures: readonly MeasureAgreement[],
): AgreementGate {
  const failing = measures
    .filter((m) => !m.passes)
    .map((m) => ({ measure: m.measure, kappa: m.kappa, n: m.n }));
  return { met: measures.length > 0 && failing.length === 0, failing };
}

// --- The weekly random sample -------------------------------------------------------

/** How many judged debriefs the weekly job puts in the advisor's queue. */
export const AGREEMENT_SAMPLE_SIZE = 5;

/** It stops adding while this many sampled debriefs still wait for a verdict. */
export const AGREEMENT_SAMPLE_BACKLOG = 2 * AGREEMENT_SAMPLE_SIZE;

/** How far back the sample looks for judged debriefs. */
export const AGREEMENT_SAMPLE_WINDOW_DAYS = 28;

/**
 * Pick `k` at random (a partial Fisher–Yates shuffle), topped up only to the
 * backlog cap so an unread sample never piles up. `random` is injectable for
 * tests.
 */
export function pickAgreementSample<T>(
  candidates: readonly T[],
  opts: {
    size?: number;
    waiting?: number;
    backlog?: number;
    random?: () => number;
  } = {},
): T[] {
  const size = opts.size ?? AGREEMENT_SAMPLE_SIZE;
  const backlog = opts.backlog ?? AGREEMENT_SAMPLE_BACKLOG;
  const room = Math.max(0, Math.min(size, backlog - (opts.waiting ?? 0)));
  const random = opts.random ?? Math.random;
  const pool = [...candidates];
  const k = Math.min(room, pool.length);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}
