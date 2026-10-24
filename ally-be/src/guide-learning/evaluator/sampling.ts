import { GuideEvaluatorPolicy } from 'src/guide/release/guide-release.bundle';

/**
 * Which production windows the nightly evaluator judges (plans/ally-guide/
 * plan.md §7.13, Appendix A "Nightly sampling"): every flagged window up to
 * 200, safety first, plus 5% of the rest up to 300. While a canary runs each
 * cap is split evenly between the arms — the canary is a fifth of traffic at
 * most, and an even split is what gives its verdict enough windows to mean
 * anything. An arm that cannot fill its half passes the rest to the other.
 *
 * Pure; randomness is injected so tests can pin it.
 */

export type Arm = 'ga' | 'canary';

export interface SampleCandidate {
  turnId: string;
  arm: Arm;
  /** Why the window is flagged; empty for an ordinary one. */
  flags: string[];
  /** A safety flag: judged first, and always sent to a person. */
  safety: boolean;
}

export interface SamplePlan {
  flagged: SampleCandidate[];
  random: SampleCandidate[];
  /** Flagged windows over the cap, left unjudged (counted, never silent). */
  flaggedDropped: number;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Take up to `cap`, half from each arm, spilling an arm's unused half to the other. */
export function takeSplit<T extends { arm: Arm }>(
  items: T[],
  cap: number,
): T[] {
  const ga = items.filter((item) => item.arm === 'ga');
  const canary = items.filter((item) => item.arm === 'canary');
  const half = Math.floor(cap / 2);
  const gaShare = Math.min(ga.length, half);
  const canaryShare = Math.min(canary.length, cap - half);
  const fromGa = Math.min(ga.length, gaShare + (cap - half - canaryShare));
  const fromCanary = Math.min(canary.length, canaryShare + (half - gaShare));
  return [...ga.slice(0, fromGa), ...canary.slice(0, fromCanary)];
}

export function planSample(
  candidates: SampleCandidate[],
  input: {
    canaryActive: boolean;
    policy: Pick<
      GuideEvaluatorPolicy,
      'flaggedMax' | 'randomShare' | 'randomMax'
    >;
    random: () => number;
  },
): SamplePlan {
  const { policy, random } = input;
  // Safety flags first, then the rest of the flagged, each in random order
  // so the cap never favours one thread or hour.
  const flaggedPool = [
    ...shuffle(
      candidates.filter((c) => c.flags.length && c.safety),
      random,
    ),
    ...shuffle(
      candidates.filter((c) => c.flags.length && !c.safety),
      random,
    ),
  ];
  const flagged = input.canaryActive
    ? takeSplit(flaggedPool, policy.flaggedMax)
    : flaggedPool.slice(0, policy.flaggedMax);
  // Safety windows are never dropped for the per-arm split.
  for (const candidate of flaggedPool) {
    if (candidate.safety && !flagged.includes(candidate)) {
      if (flagged.length < policy.flaggedMax) flagged.push(candidate);
    }
  }

  const rest = shuffle(
    candidates.filter((c) => !c.flags.length),
    random,
  );
  const quota = Math.min(
    policy.randomMax,
    Math.ceil(rest.length * policy.randomShare),
  );
  const sampled = input.canaryActive
    ? takeSplit(rest, quota)
    : rest.slice(0, quota);

  return {
    flagged,
    random: sampled,
    flaggedDropped: flaggedPool.length - flagged.length,
  };
}

/**
 * How many of `n` judged windows go to people as the calibration sample:
 * `share × n`, with the fraction rounded up or down at random so the expected
 * count is exact even on a quiet night.
 */
export function calibrationCount(
  n: number,
  share: number,
  random: () => number,
): number {
  const exact = n * share;
  const whole = Math.floor(exact);
  return whole + (random() < exact - whole ? 1 : 0);
}
