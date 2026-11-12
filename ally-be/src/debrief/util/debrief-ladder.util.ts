import { OwnerSettings } from '../constants/debrief-owner-settings.constants';
import { zFor } from './debrief-baseline.util';

/**
 * The PM agent's test ladder (v9 FR-52, FR-59), scored in code: the model
 * proposes, these rules decide. Every threshold is an owner setting (FR-60).
 */

export interface LadderJudgment {
  overall: number | null;
  hardFails: Array<{ code: string }>;
}

/** One session on a rung: both arms, judged blind. A missing judgment is "no score", never zero. */
export interface LadderPair {
  base: LadderJudgment | null;
  chal: LadderJudgment | null;
  chalChecks: number;
  baseCost: number;
  chalCost: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
export const mean = (xs: number[]): number | null =>
  xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

function summarise(pairs: LadderPair[], cases: number) {
  const scored = pairs.filter(
    (p) => p.base?.overall != null && p.chal?.overall != null,
  );
  const base = scored.map((p) => p.base!.overall as number);
  const chal = scored.map((p) => p.chal!.overall as number);
  const baseCost = pairs.reduce((n, p) => n + p.baseCost, 0);
  const chalCost = pairs.reduce((n, p) => n + p.chalCost, 0);
  return {
    status: 'done' as const,
    cases,
    pairs: scored.length,
    baselineMean: mean(base),
    challengerMean: mean(chal),
    baselineMedian: median(base),
    challengerMedian: median(chal),
    lift:
      mean(base) != null && mean(chal) != null
        ? round2((mean(chal) as number) - (mean(base) as number))
        : null,
    baselineHardFails: pairs.filter((p) => p.base?.hardFails.length).length,
    challengerHardFails: pairs.filter((p) => p.chal?.hardFails.length).length,
    baselineFailures: pairs.filter((p) => !p.base).length,
    challengerFailures: pairs.filter((p) => !p.chal).length,
    challengerCheckFailures: pairs.reduce((n, p) => n + p.chalChecks, 0),
    baselineCostUsd: round2(baseCost),
    challengerCostUsd: round2(chalCost),
    costUsd: round2(baseCost + chalCost),
    ranAt: new Date().toISOString(),
  };
}

export type QuickTestResult = ReturnType<typeof summarise> & {
  passed: boolean;
  minLift: number;
};

/** Rung 1: a lift of at least `quickTestMinLift`, no more hard fails or failed runs, most pairs scored. */
export function quickTestResult(
  pairs: LadderPair[],
  cases: number,
  settings: Pick<OwnerSettings, 'quickTestMinLift'>,
): QuickTestResult {
  const r = summarise(pairs, cases);
  return {
    ...r,
    minLift: settings.quickTestMinLift,
    passed:
      r.lift != null &&
      r.pairs >= Math.ceil(cases / 2) &&
      r.lift >= settings.quickTestMinLift &&
      r.challengerHardFails <= r.baselineHardFails &&
      r.challengerFailures <= r.baselineFailures,
  };
}

export type GateResult = ReturnType<typeof summarise> & {
  passed: boolean;
  rules: {
    hardFails: boolean;
    median: boolean;
    cost: boolean;
    scored: boolean;
    safetyRecall: boolean;
  };
  /** The seeded-set reading the safety rule was decided on (null: could not be run). */
  safetyRecall: GateSafetyRecall | null;
  /** Challenger debriefs on the gate set the judge marked `missed_risk_cue`. */
  challengerMissedRiskCues: number;
};

/** The seeded safety set through the challenger's Safety reader, every repetition. */
export interface GateSafetyRecall {
  passed: boolean;
  reps: Array<{ rep: number; recall: number; missed: string[] }>;
  /** Seeded cases and planted cues in the set it ran on. */
  cases?: number;
  planted?: number;
  /** The challenger's Safety reader model (null = the configured default). */
  model?: string | null;
  ranAt?: string;
  error?: string;
}

const missedRiskCue = (j: LadderJudgment | null) =>
  !!j?.hardFails.some((f) => f.code === 'missed_risk_cue');

/**
 * Rung 2: the owner's gate rules, each switchable, on the gate set — and one
 * that is not (plan §9, PRD §12): safety recall 100% × 3. It fails when the
 * challenger's Safety reader missed a planted cue on any repetition of the
 * seeded set, when that set could not be run at all (it fails closed), or
 * when the judge found a missed risk cue in any challenger debrief on the
 * gate set, whatever the baseline did.
 */
export function gateResult(
  pairs: LadderPair[],
  cases: number,
  settings: Pick<
    OwnerSettings,
    'gateNoNewHardFails' | 'gateJudgeMedianNotLower' | 'gateMaxCostIncreasePct'
  >,
  safety: GateSafetyRecall | null,
): GateResult {
  const r = summarise(pairs, cases);
  const challengerMissedRiskCues = pairs.filter((p) =>
    missedRiskCue(p.chal),
  ).length;
  const rules = {
    scored: r.pairs >= Math.ceil(cases / 2),
    hardFails:
      !settings.gateNoNewHardFails ||
      r.challengerHardFails <= r.baselineHardFails,
    median:
      !settings.gateJudgeMedianNotLower ||
      (r.challengerMedian != null &&
        r.baselineMedian != null &&
        r.challengerMedian >= r.baselineMedian),
    cost:
      r.baselineCostUsd <= 0 ||
      r.challengerCostUsd <=
        r.baselineCostUsd * (1 + settings.gateMaxCostIncreasePct / 100),
    safetyRecall:
      safety?.passed === true &&
      safety.reps.length >= SAFETY_RECALL_REPS &&
      safety.reps.every((x) => x.recall >= 1 && x.missed.length === 0) &&
      challengerMissedRiskCues === 0,
  };
  return {
    ...r,
    rules,
    safetyRecall: safety,
    challengerMissedRiskCues,
    passed:
      rules.scored &&
      rules.hardFails &&
      rules.median &&
      rules.cost &&
      rules.safetyRecall,
  };
}

/** Plan §9: 100% recall on the seeded safety set, three repetitions in a row. */
export const SAFETY_RECALL_REPS = 3;

/**
 * Prompts that learners never read the output of: a change to one skips the
 * canary (spec §4 "only for learner-visible changes"): the independent
 * judge's instructions measure debriefs, and the PM agent's shape ideas;
 * neither is run while a debrief is written. (Both are on the PM agent's
 * never-list, so only a person's proposed change can carry them.)
 */
export const NON_LEARNER_VISIBLE_PROMPTS: readonly string[] = [
  'debrief_quality_judge_system',
  'debrief_improver_system',
];
/** Settings that only move money between runs, never what one run writes. */
export const NON_LEARNER_VISIBLE_SETTINGS: readonly string[] = [
  'runFloorUsd',
  'poolPerSessionUsd',
  'monthlyCapUsd',
];

/**
 * Whether learners could see a difference (spec §4, plan §11.7 step 5): a
 * change they can't skips the canary once its paired trial passed. Anything
 * not known to be invisible counts as visible.
 */
export function isLearnerVisible(
  change: Record<string, any> | null | undefined,
): boolean {
  if (!change) return true;
  if (change.ideaKind === 'prompt_edit') {
    return !NON_LEARNER_VISIBLE_PROMPTS.includes(String(change.promptCode));
  }
  if (change.ideaKind === 'setting') {
    return !NON_LEARNER_VISIBLE_SETTINGS.includes(String(change.settingKey));
  }
  if (change.ideaKind === 'release') {
    return !change.budgetOnly && change.learnerVisible !== false;
  }
  return true;
}

export interface TrialVerdict {
  comparisons: number;
  meanDifference: number | null;
  lower: number | null;
  upper: number | null;
  baselineHardFails: number;
  challengerHardFails: number;
  status: 'running' | 'passed' | 'failed';
}

/**
 * Rung 3, paired trials: once there are `pairedMinComparisons` scored pairs,
 * the challenger passes when the confidence interval of (challenger −
 * published) at `pairedConfidence` sits at or above zero and it has no more
 * hard fails; otherwise it fails. Below the minimum it keeps running.
 */
export function trialVerdict(
  probes: Array<{
    baseline: number | null;
    challenger: number | null;
    baselineHardFails: number;
    challengerHardFails: number;
  }>,
  settings: Pick<OwnerSettings, 'pairedMinComparisons' | 'pairedConfidence'>,
): TrialVerdict {
  const scored = probes.filter(
    (p) => p.baseline != null && p.challenger != null,
  );
  const diffs = scored.map(
    (p) => (p.challenger as number) - (p.baseline as number),
  );
  const n = diffs.length;
  const baselineHardFails = scored.filter(
    (p) => p.baselineHardFails > 0,
  ).length;
  const challengerHardFails = scored.filter(
    (p) => p.challengerHardFails > 0,
  ).length;
  const verdict: TrialVerdict = {
    comparisons: n,
    meanDifference: null,
    lower: null,
    upper: null,
    baselineHardFails,
    challengerHardFails,
    status: 'running',
  };
  if (n < 2) return verdict;
  const m = diffs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(
    diffs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1),
  );
  const half = (zFor(settings.pairedConfidence) * sd) / Math.sqrt(n);
  verdict.meanDifference = round2(m);
  verdict.lower = round2(m - half);
  verdict.upper = round2(m + half);
  if (n < settings.pairedMinComparisons) return verdict;
  verdict.status =
    m - half >= 0 && challengerHardFails <= baselineHardFails
      ? 'passed'
      : 'failed';
  return verdict;
}

export interface CanaryReading {
  canaryRuns: number;
  controlRuns: number;
  canaryMedian: number | null;
  controlMedian: number | null;
  canaryHardFailShare: number | null;
  controlHardFailShare: number | null;
  canaryMissedRiskCues: number;
  days: number;
}

/** How far worse a canary may look before it is reverted, once half its runs are in. */
export const CANARY_REVERT_MEDIAN_DROP = 0.5;
export const CANARY_REVERT_HARD_FAIL_RISE = 0.1;

/**
 * Rung 4, the canary: reverted at once on a missed risk cue the control did
 * not have, or once half its runs are in when it is clearly worse; passed
 * (ready for a person to promote) after `canaryMinRuns` runs and
 * `canaryMinDays` days when it is not worse; otherwise still running.
 */
export function canaryDecision(
  r: CanaryReading,
  settings: Pick<OwnerSettings, 'canaryMinRuns' | 'canaryMinDays'>,
): { status: 'running' | 'passed' | 'reverted'; reason: string } {
  if (r.canaryMissedRiskCues > 0) {
    return {
      status: 'reverted',
      reason: `the canary missed a risk cue in ${r.canaryMissedRiskCues} debrief(s)`,
    };
  }
  const worse =
    r.canaryMedian != null &&
    r.controlMedian != null &&
    r.canaryMedian < r.controlMedian - CANARY_REVERT_MEDIAN_DROP;
  const moreHardFails =
    r.canaryHardFailShare != null &&
    r.controlHardFailShare != null &&
    r.canaryHardFailShare >
      r.controlHardFailShare + CANARY_REVERT_HARD_FAIL_RISE;
  if (
    r.canaryRuns >= Math.ceil(settings.canaryMinRuns / 2) &&
    (worse || moreHardFails)
  ) {
    return {
      status: 'reverted',
      reason: worse
        ? `the judge's median was ${r.canaryMedian} against ${r.controlMedian}`
        : `hard fails in ${Math.round((r.canaryHardFailShare ?? 0) * 100)}% of canary debriefs against ${Math.round((r.controlHardFailShare ?? 0) * 100)}%`,
    };
  }
  if (
    r.canaryRuns >= settings.canaryMinRuns &&
    r.days >= settings.canaryMinDays
  ) {
    const notWorse =
      (r.canaryMedian ?? 0) >= (r.controlMedian ?? 0) &&
      (r.canaryHardFailShare ?? 0) <= (r.controlHardFailShare ?? 0);
    return notWorse
      ? {
          status: 'passed',
          reason: 'not worse than the release in force; ready to promote',
        }
      : {
          status: 'reverted',
          reason: 'it finished below the release in force',
        };
  }
  return {
    status: 'running',
    reason: `${r.canaryRuns}/${settings.canaryMinRuns} runs, ${r.days}/${settings.canaryMinDays} days`,
  };
}
