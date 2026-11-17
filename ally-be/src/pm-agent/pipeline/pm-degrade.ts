export interface PmDegradePlan {
  laneCount: number;
  cheapModel: boolean;
  candidatesPerLane: number;
  /** Nothing affordable: the run stops before any lane (stopReason budget). */
  stop: boolean;
  steps: string[];
}

/**
 * The degradation order when the run budget is short (plan §10), decided BEFORE spending:
 *
 *  1. skip the lowest-weight lanes (lanes arrive ordered by selection score);
 *  2. switch to the cheaper tier model;
 *  3. ask each lane for fewer candidates;
 *  4. stop.
 *
 * Estimates are typical lane costs; the ledger still enforces the hard per-call reservation,
 * so a wrong estimate can only end a lane early, never overspend.
 */
export function planDegradation(input: {
  laneBudgetUsd: number;
  fullLaneUsd: number;
  cheapLaneUsd: number;
  laneCount: number;
  candidatesPerLane: number;
}): PmDegradePlan {
  const steps: string[] = [];
  const fits = (unit: number) =>
    unit > 0 ? Math.floor(input.laneBudgetUsd / unit) : input.laneCount;
  if (input.laneCount <= 0) {
    return {
      laneCount: 0,
      cheapModel: false,
      candidatesPerLane: input.candidatesPerLane,
      stop: false,
      steps,
    };
  }
  const full = fits(input.fullLaneUsd);
  if (full >= input.laneCount) {
    return {
      laneCount: input.laneCount,
      cheapModel: false,
      candidatesPerLane: input.candidatesPerLane,
      stop: false,
      steps,
    };
  }
  if (full >= 1) {
    steps.push(`skipped ${input.laneCount - full} lowest-weight lane(s)`);
    return {
      laneCount: full,
      cheapModel: false,
      candidatesPerLane: input.candidatesPerLane,
      stop: false,
      steps,
    };
  }
  const cheap = fits(input.cheapLaneUsd);
  if (cheap >= 1) {
    const laneCount = Math.min(input.laneCount, cheap);
    if (laneCount < input.laneCount) {
      steps.push(
        `skipped ${input.laneCount - laneCount} lowest-weight lane(s)`,
      );
    }
    steps.push('switched to the cheaper model', 'asked for fewer candidates');
    return {
      laneCount,
      cheapModel: true,
      candidatesPerLane: Math.max(1, Math.floor(input.candidatesPerLane / 2)),
      stop: false,
      steps,
    };
  }
  steps.push('not enough budget for one lane');
  return {
    laneCount: 0,
    cheapModel: true,
    candidatesPerLane: 0,
    stop: true,
    steps,
  };
}
