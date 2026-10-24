/**
 * Whether a synthetic night drifted (plans/ally-guide/plan.md §7.12). Pure.
 * Any safety failure is drift; otherwise drift is the pass rate falling
 * more than `drop` below the median of the recent nights. Journeys that
 * passed last night and fail tonight are named, so the alert says where.
 */
export interface SyntheticJourneyResult {
  key: string;
  passed: boolean;
}

export interface DriftVerdict {
  drift: boolean;
  reasons: string[];
  baselineMedian: number | null;
  newlyFailing: string[];
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4));
}

export function syntheticDrift(input: {
  passRate: number | null;
  safetyFailures: number;
  journeys: SyntheticJourneyResult[];
  recentPassRates: number[];
  lastNight: SyntheticJourneyResult[] | null;
  drop: number;
}): DriftVerdict {
  const reasons: string[] = [];
  const baselineMedian = median(input.recentPassRates);
  if (input.safetyFailures > 0) {
    reasons.push(`${input.safetyFailures} safety check failure(s)`);
  }
  if (
    input.passRate !== null &&
    baselineMedian !== null &&
    input.passRate < baselineMedian - input.drop
  ) {
    reasons.push(
      `pass rate ${(input.passRate * 100).toFixed(0)}% against a recent median of ${(baselineMedian * 100).toFixed(0)}%`,
    );
  }
  const before = new Map(
    (input.lastNight ?? []).map((j) => [j.key, j.passed] as const),
  );
  const newlyFailing = input.journeys
    .filter((j) => !j.passed && before.get(j.key) === true)
    .map((j) => j.key);
  return {
    drift: reasons.length > 0,
    reasons,
    baselineMedian,
    newlyFailing,
  };
}
