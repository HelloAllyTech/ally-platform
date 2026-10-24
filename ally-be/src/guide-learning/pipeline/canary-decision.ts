import { GuideLoopPolicy } from 'src/guide/release/guide-release.bundle';
import { GuardResult } from '../evals/gate';

/**
 * The canary's automatic decision (plans/ally-guide/plan.md §7.13,
 * Appendix A "Learning loop"; Stacks: Canary Deployments for Safe Agent
 * Iteration — compare version-tagged metrics against the baseline, roll back
 * at once on a regression). Pure: the monitor gathers, this decides.
 *
 *  1. Harm reverts at once, whatever the sample: more safety-check failures
 *     on the canary than on GA, turn failures well above GA's, or the
 *     learning-metric guard failing (engagement up while learning is flat
 *     or falling). Auto-revert is always on.
 *  2. No decision before 4 days with ≥ 120 canary threads, ≥ 80 judged
 *     windows and ≥ 100 rated turns.
 *  3. Then only κ-trusted criteria count: any trusted criterion whose fail
 *     rate is worse on the canary by more than the margin reverts it.
 *  4. Promotion needs at least one trusted criterion with enough judged
 *     windows in both arms, and the learning guard to pass, not just to be
 *     pending. Without them the canary is inconclusive.
 *  5. Inconclusive at 14 days reverts.
 */

export interface ArmStats {
  threads: number;
  turns: number;
  failureRate: number | null;
  ratedTurns: number;
  judgedWindows: number;
  /** Judged windows with a failed safety check. */
  safetyFailureWindows: number;
}

export interface CriterionArms {
  id: string;
  ga: { fail: number; judged: number };
  canary: { fail: number; judged: number };
}

export interface CanaryEvidence {
  daysRunning: number;
  ga: ArmStats | null;
  canary: ArmStats | null;
  /** Trusted criteria only; untrusted ones never reach the decision. */
  criteria: CriterionArms[];
  trusted: string[];
  guard: GuardResult;
}

export type CanaryAction = 'wait' | 'promote' | 'revert';

export interface CanaryDecision {
  action: CanaryAction;
  /** A safety reason: every canary thread moves to GA at its next turn. */
  emergency: boolean;
  reasons: string[];
  /** Whether the earliest-decision thresholds are met. */
  ready: boolean;
  thresholds: Record<string, { need: number; have: number; met: boolean }>;
  criteria: Array<{
    id: string;
    gaRate: number | null;
    canaryRate: number | null;
    verdict: 'better' | 'same' | 'worse' | 'too_few';
  }>;
  guard: GuardResult;
}

/** Judged windows a criterion needs in each arm before it counts. */
export const MIN_JUDGED_PER_CRITERION = 10;
/** Canary turns before the failure-rate harm rule applies. */
export const MIN_TURNS_FOR_FAILURE_RULE = 50;
/** How far above GA the canary's turn failure rate may go. */
export const FAILURE_RATE_MARGIN = 0.05;
/** Safety-failing windows on the canary before the safety rule applies. */
export const MIN_SAFETY_FAILURES = 2;

const rateOf = (fail: number, judged: number) =>
  judged ? Number((fail / judged).toFixed(4)) : null;

export function decideCanary(
  evidence: CanaryEvidence,
  policy: Pick<
    GuideLoopPolicy,
    | 'canaryMinDays'
    | 'canaryMinThreads'
    | 'canaryMinJudgedWindows'
    | 'canaryMinRatedTurns'
    | 'canaryInconclusiveDays'
    | 'qualityMargin'
  >,
): CanaryDecision {
  const canary = evidence.canary;
  const ga = evidence.ga;
  const thresholds = {
    days: {
      need: policy.canaryMinDays,
      have: Number(evidence.daysRunning.toFixed(2)),
      met: evidence.daysRunning >= policy.canaryMinDays,
    },
    threads: {
      need: policy.canaryMinThreads,
      have: canary?.threads ?? 0,
      met: (canary?.threads ?? 0) >= policy.canaryMinThreads,
    },
    judgedWindows: {
      need: policy.canaryMinJudgedWindows,
      have: canary?.judgedWindows ?? 0,
      met: (canary?.judgedWindows ?? 0) >= policy.canaryMinJudgedWindows,
    },
    ratedTurns: {
      need: policy.canaryMinRatedTurns,
      have: canary?.ratedTurns ?? 0,
      met: (canary?.ratedTurns ?? 0) >= policy.canaryMinRatedTurns,
    },
  };
  const ready = Object.values(thresholds).every((t) => t.met);
  const trusted = new Set(evidence.trusted);
  const criteria = evidence.criteria
    .filter((c) => trusted.has(c.id))
    .map((c) => {
      const gaRate = rateOf(c.ga.fail, c.ga.judged);
      const canaryRate = rateOf(c.canary.fail, c.canary.judged);
      const enough =
        c.ga.judged >= MIN_JUDGED_PER_CRITERION &&
        c.canary.judged >= MIN_JUDGED_PER_CRITERION;
      const verdict: 'better' | 'same' | 'worse' | 'too_few' = !enough
        ? 'too_few'
        : canaryRate! > gaRate! + policy.qualityMargin
          ? 'worse'
          : canaryRate! < gaRate! - policy.qualityMargin
            ? 'better'
            : 'same';
      return { id: c.id, gaRate, canaryRate, verdict };
    });
  const base = {
    ready,
    thresholds,
    criteria,
    guard: evidence.guard,
  };
  const decide = (
    action: CanaryAction,
    reasons: string[],
    emergency = false,
  ): CanaryDecision => ({ action, emergency, reasons, ...base });

  // 1. Harm, at any sample size.
  if (canary && ga) {
    const canaryShare = canary.judgedWindows
      ? canary.safetyFailureWindows / canary.judgedWindows
      : 0;
    const gaShare = ga.judgedWindows
      ? ga.safetyFailureWindows / ga.judgedWindows
      : 0;
    if (
      canary.safetyFailureWindows >= MIN_SAFETY_FAILURES &&
      canaryShare > gaShare
    ) {
      return decide(
        'revert',
        [
          `safety checks failed on ${canary.safetyFailureWindows} canary windows (${(canaryShare * 100).toFixed(1)}%) against ${(gaShare * 100).toFixed(1)}% on GA`,
        ],
        true,
      );
    }
    if (
      canary.turns >= MIN_TURNS_FOR_FAILURE_RULE &&
      canary.failureRate !== null &&
      canary.failureRate > (ga.failureRate ?? 0) + FAILURE_RATE_MARGIN
    ) {
      return decide('revert', [
        `turns fail on ${(canary.failureRate * 100).toFixed(1)}% of canary turns against ${((ga.failureRate ?? 0) * 100).toFixed(1)}% on GA`,
      ]);
    }
  }
  if (evidence.guard.status === 'fail') {
    return decide('revert', [`learning guard: ${evidence.guard.reason}`]);
  }

  const inconclusive = (why: string[]): CanaryDecision =>
    evidence.daysRunning >= policy.canaryInconclusiveDays
      ? decide('revert', [
          `inconclusive after ${policy.canaryInconclusiveDays} days`,
          ...why,
        ])
      : decide('wait', why);

  // 2. The earliest decision.
  if (!ready) {
    return inconclusive(
      Object.entries(thresholds)
        .filter(([, t]) => !t.met)
        .map(([name, t]) => `${name}: ${t.have} of ${t.need}`),
    );
  }

  // 3. Quality, on trusted criteria only.
  const worse = criteria.filter((c) => c.verdict === 'worse');
  if (worse.length) {
    return decide(
      'revert',
      worse.map(
        (c) =>
          `${c.id} fails on ${((c.canaryRate ?? 0) * 100).toFixed(1)}% of canary windows against ${((c.gaRate ?? 0) * 100).toFixed(1)}% on GA`,
      ),
    );
  }

  // 4. Enough to promote?
  const measured = criteria.filter((c) => c.verdict !== 'too_few');
  const missing: string[] = [];
  if (!measured.length) {
    missing.push(
      evidence.trusted.length
        ? `no trusted criterion has ${MIN_JUDGED_PER_CRITERION}+ judged windows in both arms`
        : 'no criterion is trusted yet (agreement with people under the threshold)',
    );
  }
  if (evidence.guard.status !== 'pass') {
    missing.push(
      `learning guard ${evidence.guard.status}: ${evidence.guard.reason}`,
    );
  }
  if (missing.length) return inconclusive(missing);

  return decide('promote', [
    `no trusted criterion worse (${measured.map((c) => `${c.id} ${c.verdict}`).join(', ')}); learning kept pace with engagement`,
  ]);
}
