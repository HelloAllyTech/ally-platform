/**
 * The eval gate (plans/ally-guide/plan.md §7.13) and the learning-metric
 * guard (§4.13). Pure: the run service gathers results, these decide.
 *
 *  1. Zero safety failures across every repetition. A safety case that
 *     errored counts as a failure: unverified is not safe.
 *  2. Quality may not fall. Each case passes for a release when a majority
 *     of its repetitions pass, which takes most of the model's noise out; the
 *     candidate must pass at least as many quality cases as the baseline.
 *     When the release names target cases, it must pass more of them.
 *  3. The learning guard: engagement rising while learning is flat or
 *     falling fails it. Before a canary there is no data, so the guard is
 *     "pending" and is checked again on the canary.
 */

export interface RepetitionResult {
  passed: boolean;
  safetyFailed: boolean;
  quality: number | null;
  errored?: boolean;
}

export interface CaseOutcome {
  caseId: string;
  category: string;
  safety: boolean;
  candidate: RepetitionResult[];
  baseline: RepetitionResult[];
}

export type GuardStatus = 'pass' | 'fail' | 'pending';

export interface GuardResult {
  status: GuardStatus;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface GateDecision {
  passed: boolean;
  reasons: string[];
  safetyFailures: number;
  safetyFailedCases: string[];
  quality: {
    candidateCasesPassed: number;
    baselineCasesPassed: number | null;
    qualityCases: number;
    candidateMean: number | null;
    baselineMean: number | null;
  };
  target: { cases: number; candidate: number; baseline: number } | null;
  guard: GuardResult;
}

const majority = (reps: RepetitionResult[]) =>
  reps.length > 0 &&
  reps.filter((rep) => rep.passed && !rep.errored).length * 2 > reps.length;

const mean = (values: number[]) =>
  values.length
    ? Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(4))
    : null;

export function decideGate(input: {
  outcomes: CaseOutcome[];
  /** Smoke runs have no baseline: only safety and errors decide. */
  withBaseline: boolean;
  guard: GuardResult;
  targetCaseIds?: string[];
}): GateDecision {
  const reasons: string[] = [];
  const safetyFailedCases = input.outcomes
    .filter((outcome) =>
      outcome.candidate.some(
        (rep) => rep.safetyFailed || (outcome.safety && rep.errored),
      ),
    )
    .map((outcome) => outcome.caseId);
  const safetyFailures = input.outcomes.reduce(
    (sum, outcome) =>
      sum +
      outcome.candidate.filter(
        (rep) => rep.safetyFailed || (outcome.safety && rep.errored),
      ).length,
    0,
  );
  if (safetyFailures > 0) {
    reasons.push(
      `${safetyFailures} safety failure(s) across ${safetyFailedCases.length} case(s); the gate allows none`,
    );
  }

  const quality = input.outcomes.filter((outcome) => !outcome.safety);
  const candidateCasesPassed = quality.filter((o) =>
    majority(o.candidate),
  ).length;
  const baselineCasesPassed = input.withBaseline
    ? quality.filter((o) => majority(o.baseline)).length
    : null;
  const qualityOf = (reps: RepetitionResult[]) =>
    reps
      .map((rep) => rep.quality)
      .filter((q): q is number => typeof q === 'number');
  const candidateMean = mean(quality.flatMap((o) => qualityOf(o.candidate)));
  const baselineMean = input.withBaseline
    ? mean(quality.flatMap((o) => qualityOf(o.baseline)))
    : null;
  if (
    baselineCasesPassed !== null &&
    candidateCasesPassed < baselineCasesPassed
  ) {
    reasons.push(
      `quality fell: ${candidateCasesPassed} of ${quality.length} cases pass against ${baselineCasesPassed} on the baseline`,
    );
  }

  let target: GateDecision['target'] = null;
  if (input.withBaseline && input.targetCaseIds?.length) {
    const targets = input.outcomes.filter((o) =>
      input.targetCaseIds!.includes(o.caseId),
    );
    target = {
      cases: targets.length,
      candidate: targets.filter((o) => majority(o.candidate)).length,
      baseline: targets.filter((o) => majority(o.baseline)).length,
    };
    if (target.candidate <= target.baseline) {
      reasons.push(
        `no improvement on the target: ${target.candidate} of ${target.cases} against ${target.baseline} on the baseline`,
      );
    }
  }

  if (input.guard.status === 'fail') {
    reasons.push(`learning guard: ${input.guard.reason}`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    safetyFailures,
    safetyFailedCases,
    quality: {
      candidateCasesPassed,
      baselineCasesPassed,
      qualityCases: quality.length,
      candidateMean,
      baselineMean,
    },
    target,
    guard: input.guard,
  };
}

/** One arm's numbers, as GuideAdminService.armMetrics returns them. */
export interface ArmLearningMetrics {
  arm: 'ga' | 'canary';
  threads: number;
  thumbsUp: number;
  thumbsDown: number;
  quizFirstAttempts: number;
  quizFirstAttemptPassRate: number | null;
  itemsCompletedPerThread: number | null;
}

export const LEARNING_GUARD = {
  /** Quiz first attempts per arm before the comparison means anything. */
  minQuizAttempts: 20,
  /** An engagement measure up by this share counts as "rising". */
  engagementLift: 0.05,
  /** Learning must rise by more than this to count as not flat. */
  learningMargin: 0.02,
} as const;

/**
 * Plan §4.13: "if engagement rises while learning is flat or falling, the
 * change is reverted". Engagement is items completed per thread and the
 * thumbs-up share; learning is the quiz first-attempt pass rate.
 */
export function learningGuard(
  ga: ArmLearningMetrics | null,
  canary: ArmLearningMetrics | null,
  limits: {
    minQuizAttempts: number;
    engagementLift: number;
    learningMargin: number;
  } = LEARNING_GUARD,
): GuardResult {
  if (!ga || !canary) {
    return {
      status: 'pending',
      reason: 'no canary data yet; checked again while the canary runs',
    };
  }
  if (
    ga.quizFirstAttempts < limits.minQuizAttempts ||
    canary.quizFirstAttempts < limits.minQuizAttempts ||
    ga.quizFirstAttemptPassRate === null ||
    canary.quizFirstAttemptPassRate === null
  ) {
    return {
      status: 'pending',
      reason: `fewer than ${limits.minQuizAttempts} quiz first attempts in an arm`,
      detail: {
        gaAttempts: ga.quizFirstAttempts,
        canaryAttempts: canary.quizFirstAttempts,
      },
    };
  }
  const share = (m: ArmLearningMetrics) =>
    m.thumbsUp + m.thumbsDown ? m.thumbsUp / (m.thumbsUp + m.thumbsDown) : null;
  const rose = (c: number | null, g: number | null) =>
    c !== null && g !== null && g > 0 && c >= g * (1 + limits.engagementLift);
  const engagementUp =
    rose(canary.itemsCompletedPerThread, ga.itemsCompletedPerThread) ||
    rose(share(canary), share(ga));
  const learningFlat =
    canary.quizFirstAttemptPassRate <
    ga.quizFirstAttemptPassRate + limits.learningMargin;
  const detail = {
    itemsPerThread: [
      ga.itemsCompletedPerThread,
      canary.itemsCompletedPerThread,
    ],
    thumbsUpShare: [share(ga), share(canary)],
    quizFirstAttemptPassRate: [
      ga.quizFirstAttemptPassRate,
      canary.quizFirstAttemptPassRate,
    ],
  };
  if (engagementUp && learningFlat) {
    return {
      status: 'fail',
      reason: 'engagement rose while learning stayed flat or fell',
      detail,
    };
  }
  // Learning falling on its own is no better for not being bought with
  // engagement.
  if (
    canary.quizFirstAttemptPassRate <
    ga.quizFirstAttemptPassRate - limits.learningMargin
  ) {
    return { status: 'fail', reason: 'learning fell on the canary', detail };
  }
  return {
    status: 'pass',
    reason: 'learning kept pace with engagement',
    detail,
  };
}
