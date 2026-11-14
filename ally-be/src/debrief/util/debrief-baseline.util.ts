import {
  OWNER_SETTINGS_SPEC,
  OwnerSettingKey,
  OwnerSettingProposal,
  OwnerSettings,
  OwnerSettingSpec,
} from '../constants/debrief-owner-settings.constants';

/**
 * Starting values for the PM agent's thresholds, from production facts (the
 * owner's 2026-11-10 decision: every threshold is a setting, starting from
 * today's data). Pure: the baseline service gathers the facts and stores the
 * proposal; a person accepts it.
 */

export interface BaselineFacts {
  days: number;
  /** Production debriefs (shadow + live) per day, all organisations. */
  runsPerDay: number;
  /** Live debriefs per day in switched-on organisations: the canary's pool. */
  liveRunsPerDay: number;
  /** Eligible sessions a month, from which test sets draw. */
  eligibleSessionsPerMonth: number;
  byOrgLanguage: Array<{
    tenantId: string | null;
    language: string | null;
    perDay: number;
  }>;
  judge: {
    scored: number;
    mean: number | null;
    sd: number | null;
    median: number | null;
  };
  /** Judge score movement when the same debrief is judged again. */
  rejudge: { pairs: number; sdOfDifference: number | null };
  hardFailRate: number | null;
  costPerRunUsd: { p50: number | null; p90: number | null };
  /** Ideas the PM agent tried per month, recently. */
  ideasTriedPerMonth: number;
}

/** Two-sided normal quantile for a confidence level, at the levels the settings allow. */
export function zFor(confidence: number): number {
  if (confidence >= 0.99) return 2.576;
  if (confidence >= 0.975) return 2.241;
  if (confidence >= 0.95) return 1.96;
  if (confidence >= 0.9) return 1.645;
  return 1.282;
}
const Z_POWER_80 = 0.842;
/** The judge's cost per debrief, as the learning budget already counts it. */
const JUDGE_USD = 0.04;

/** Paired comparisons needed to see a lift of `delta` points with 80% power. */
export function pairsFor(
  sdOfDifference: number,
  delta: number,
  confidence: number,
): number {
  const n = ((zFor(confidence) + Z_POWER_80) * sdOfDifference) / delta;
  return Math.ceil(n * n);
}

const clampTo = (key: OwnerSettingKey, v: number) => {
  const spec = OWNER_SETTINGS_SPEC[key] as OwnerSettingSpec;
  const lo = spec.min ?? -Infinity;
  const hi = spec.max ?? Infinity;
  const c = Math.min(hi, Math.max(lo, v));
  return spec.kind === 'int' ? Math.round(c) : c;
};
const roundUp = (v: number, step: number) => Math.ceil(v / step) * step;

/** A value that differs from the current by more than half no longer fits. */
const misfit = (current: number | boolean, proposed: number | boolean) => {
  if (typeof current !== 'number' || typeof proposed !== 'number') return false;
  if (current === 0) return proposed !== 0;
  return Math.abs(proposed - current) / Math.abs(current) > 0.5;
};

/**
 * The proposal: a value and its reasoning per setting the data speaks to.
 * Settings the data cannot inform (the gate's rules, the confidence level)
 * are left to the person and get no proposal.
 */
export function proposeOwnerSettings(
  facts: BaselineFacts,
  current: OwnerSettings,
): Partial<Record<OwnerSettingKey, OwnerSettingProposal>> {
  const out: Partial<Record<OwnerSettingKey, OwnerSettingProposal>> = {};
  const put = (key: OwnerSettingKey, value: number, reason: string) => {
    const v = clampTo(key, value);
    out[key] = { value: v, reason, misfit: misfit(current[key], v) };
  };
  const confidence = current.pairedConfidence;
  // Two judgments of one debrief differ by this much; a challenger and a
  // baseline differ by more (different text), so allow half again. Never
  // below half a point: a tiny sample can look implausibly steady.
  const noise = facts.rejudge.sdOfDifference;
  const sdD = Math.max(0.5, (noise ?? 1) * 1.5);
  const noiseText =
    noise != null
      ? `Re-judging ${facts.rejudge.pairs} debriefs moved scores by ${noise.toFixed(2)} (standard deviation of the difference); paired differences are taken as ${sdD.toFixed(2)}.`
      : `No re-judging yet, so paired differences are assumed to vary by ${sdD.toFixed(2)} points.`;

  // Test sets draw from every organisation's sessions; each takes its share.
  const pool = (share: number) =>
    Math.max(0, Math.floor(facts.eligibleSessionsPerMonth * 4 * share));

  const quick = pairsFor(sdD, 1.0, confidence);
  put(
    'quickTestCases',
    Math.min(quick, Math.max(10, pool(0.6))),
    `${noiseText} Seeing a 1-point lift at ${Math.round(confidence * 100)}% confidence with 80% power takes ${quick} pairs.`,
  );
  const gate = pairsFor(sdD, 0.5, confidence);
  const gatePool = pool(0.25);
  put(
    'gateCases',
    Math.min(gate, Math.max(20, gatePool)),
    `Seeing a half-point drop takes ${gate} pairs; the test sessions can hold about ${gatePool} (a quarter of ${facts.eligibleSessionsPerMonth}/month over four months).`,
  );
  const gateValue = out.gateCases!.value as number;
  put(
    'sealedCases',
    Math.min(Math.round(gateValue * 0.6), Math.max(20, pool(0.15))),
    `Six tenths of the test sessions, within the sealed share of sessions (about ${pool(0.15)}).`,
  );
  const freshGate = Math.floor(facts.eligibleSessionsPerMonth * 0.25);
  put(
    'gateRotationShare',
    Math.min(0.25, freshGate / Math.max(1, gateValue)),
    `About ${freshGate} new test sessions arrive a month, so up to ${Math.min(100, Math.round((freshGate / Math.max(1, gateValue)) * 100))}% of a ${gateValue}-case set can be replaced; a quarter is the most v9 asks for.`,
  );
  const paired = pairsFor(sdD, 0.3, confidence);
  put(
    'pairedMinComparisons',
    paired,
    `Seeing a 0.3-point lift on production sessions takes ${paired} pairs.`,
  );
  const minRuns = out.pairedMinComparisons!.value as number;
  put(
    'canaryMinRuns',
    minRuns,
    'As many try-out debriefs as a side-by-side trial needs, so the two read alike.',
  );
  const live = facts.liveRunsPerDay;
  if (live > 0) {
    const share = Math.min(
      0.5,
      Math.max(0.05, minRuns / (live * current.canaryMinDays)),
    );
    put(
      'canaryShare',
      share,
      `${live.toFixed(1)} live debriefs a day; ${Math.round(share * 100)}% of them reaches ${minRuns} try-out debriefs in ${current.canaryMinDays} days.`,
    );
    const days = Math.ceil(
      minRuns / (live * (out.canaryShare!.value as number)),
    );
    put(
      'canaryMinDays',
      days,
      `At that share, ${minRuns} try-out debriefs take ${days} day(s).`,
    );
  }
  const p90 = facts.costPerRunUsd.p90;
  if (p90 != null) {
    put(
      'probeCapPerSessionUsd',
      roundUp(2 * (p90 + JUDGE_USD), 0.05),
      `A challenger debrief and two judgments; twice the costliest tenth of runs ($${p90.toFixed(3)}) plus judging.`,
    );
  }
  const p50 = facts.costPerRunUsd.p50;
  if (p50 != null) {
    const perRun = p50 + JUDGE_USD;
    const ideas = Math.max(2, facts.ideasTriedPerMonth);
    const perIdea =
      perRun *
      (2 * (out.quickTestCases!.value as number) +
        2 * gateValue +
        (out.pairedMinComparisons!.value as number));
    const sealed = perRun * (out.sealedCases!.value as number);
    const budget = roundUp(ideas * perIdea + sealed + 10, 10);
    put(
      'learningBudgetUsd',
      budget,
      `${ideas} ideas a month through the quick check, the pass test and a side-by-side trial at $${perRun.toFixed(3)} a judged debrief ($${perIdea.toFixed(2)} each), the monthly sealed run ($${sealed.toFixed(2)}) and the PM agent's own calls (~$10).`,
    );
  }
  return out;
}
