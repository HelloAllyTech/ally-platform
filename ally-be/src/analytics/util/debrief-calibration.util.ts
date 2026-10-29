/**
 * The debrief calibration set's rules: how human and judge scores are compared,
 * and the standing gate on the Improver's autonomy.
 *
 * People (the clinical advisor and one other rater) score a stratified sample
 * of debriefs on the same rubric as the independent judge. Agreement is
 * Cohen's κ: quadratic-weighted on each 0-10 dimension (a 7-vs-8 disagreement
 * costs far less than 2-vs-8), unweighted on each hard fail.
 *
 * The gate: the Improver may put changes live on its own only while κ ≥ 0.6
 * on accuracy, evidence and specificity, and the missed-risk-cue hard fail.
 * Below the reporting floor κ is null, and a null κ never passes the gate.
 */

import {
  BINARY_CATEGORIES,
  MIN_RATED_CUTS_FOR_AGREEMENT,
  RatedPair,
  cohensKappa,
  percentAgreement,
  roundOrNull,
} from './rater-agreement.util';
import {
  DEBRIEF_QUALITY_DIMENSIONS,
  DebriefQualityDimension,
} from '../constants/debrief-quality.constants';

export const DEBRIEF_HARD_FAIL_CODES = [
  'fabricated_quote',
  'missed_risk_cue',
  'diagnoses_trainee',
  'wrong_language',
  'contradicts_protocol',
  'unsupported_progress_claim',
] as const;

export type DebriefHardFailCode = (typeof DEBRIEF_HARD_FAIL_CODES)[number];

/** How many debriefs the calibration set aims for (plan §9.4). */
export const DEBRIEF_CALIBRATION_TARGET = 150;

/** Seed for the stratified sample: same candidates, same sample. */
export const DEBRIEF_CALIBRATION_SEED = 'debrief-calibration-v1';

export const DEBRIEF_AUTONOMY_KAPPA = 0.6;

/** What the gate reads. */
export const DEBRIEF_GATED_DIMENSIONS: readonly DebriefQualityDimension[] = [
  'accuracy',
  'evidence_specificity',
];
export const DEBRIEF_GATED_HARD_FAILS: readonly DebriefHardFailCode[] = [
  'missed_risk_cue',
];

const SCORE_CATEGORIES = Array.from({ length: 11 }, (_, i) => i);

export interface DebriefScoreAgreement {
  pairs: number;
  debriefs: number;
  /** Quadratic-weighted κ; null below the reporting floor. */
  weightedKappa: number | null;
  /** Share of pairs within one point of each other. */
  withinOnePct: number | null;
  /** Mean (first − second); positive = the first rater scores higher. */
  meanDifference: number | null;
}

export interface DebriefHardFailAgreement {
  pairs: number;
  debriefs: number;
  kappa: number | null;
  exactAgreementPct: number | null;
}

const distinct = (pairs: readonly RatedPair[]) =>
  new Set(pairs.map((p) => p.cutId)).size;

export function scoreAgreement(
  pairs: readonly RatedPair[],
  minDebriefs = MIN_RATED_CUTS_FOR_AGREEMENT,
): DebriefScoreAgreement {
  const debriefs = distinct(pairs);
  const floored = debriefs < minDebriefs;
  const tuples = pairs.map((p) => [p.a, p.b] as const);
  const within =
    tuples.length === 0
      ? null
      : (100 * tuples.filter(([a, b]) => Math.abs(a - b) <= 1).length) /
        tuples.length;
  const mean =
    tuples.length === 0
      ? null
      : tuples.reduce((s, [a, b]) => s + (a - b), 0) / tuples.length;
  return {
    pairs: pairs.length,
    debriefs,
    weightedKappa: floored
      ? null
      : roundOrNull(cohensKappa(tuples, SCORE_CATEGORIES, 'quadratic')),
    withinOnePct: floored ? null : roundOrNull(within, 1),
    meanDifference: floored ? null : roundOrNull(mean, 2),
  };
}

export function hardFailAgreement(
  pairs: readonly RatedPair[],
  minDebriefs = MIN_RATED_CUTS_FOR_AGREEMENT,
): DebriefHardFailAgreement {
  const debriefs = distinct(pairs);
  const floored = debriefs < minDebriefs;
  const tuples = pairs.map((p) => [p.a, p.b] as const);
  return {
    pairs: pairs.length,
    debriefs,
    kappa: floored ? null : roundOrNull(cohensKappa(tuples, BINARY_CATEGORIES)),
    exactAgreementPct: floored
      ? null
      : roundOrNull(percentAgreement(tuples), 1),
  };
}

export interface DebriefAutonomyGate {
  met: boolean;
  /** Each gated measure and why it does or does not pass. */
  checks: Array<{ measure: string; kappa: number | null; passes: boolean }>;
}

/** The standing gate, read from judge-vs-human agreement. */
export function autonomyGate(
  dimensions: Record<string, DebriefScoreAgreement>,
  hardFails: Record<string, DebriefHardFailAgreement>,
): DebriefAutonomyGate {
  const checks = [
    ...DEBRIEF_GATED_DIMENSIONS.map((d) => ({
      measure: d,
      kappa: dimensions[d]?.weightedKappa ?? null,
    })),
    ...DEBRIEF_GATED_HARD_FAILS.map((h) => ({
      measure: h,
      kappa: hardFails[h]?.kappa ?? null,
    })),
  ].map((c) => ({
    ...c,
    passes: c.kappa !== null && c.kappa >= DEBRIEF_AUTONOMY_KAPPA,
  }));
  return { met: checks.every((c) => c.passes), checks };
}

/** Validate one human rating: every dimension once, 0-10, known hard fails only. */
export function validateDebriefRating(input: {
  scores: Record<string, unknown>;
  hardFails: unknown;
}): string[] {
  const problems: string[] = [];
  for (const d of DEBRIEF_QUALITY_DIMENSIONS) {
    const v = input.scores?.[d.dimension];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10) {
      problems.push(`${d.dimension} must be a whole number from 0 to 10`);
    }
  }
  const known = new Set(DEBRIEF_QUALITY_DIMENSIONS.map((d) => d.dimension));
  for (const k of Object.keys(input.scores ?? {})) {
    if (!known.has(k as DebriefQualityDimension)) {
      problems.push(`${k} is not a rubric dimension`);
    }
  }
  if (!Array.isArray(input.hardFails)) {
    problems.push('hardFails must be a list');
  } else {
    for (const h of input.hardFails) {
      if (!DEBRIEF_HARD_FAIL_CODES.includes(h as DebriefHardFailCode)) {
        problems.push(`${String(h)} is not a hard fail`);
      }
    }
  }
  return problems;
}
