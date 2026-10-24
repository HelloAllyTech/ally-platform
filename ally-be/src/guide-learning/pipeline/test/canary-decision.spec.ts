import { GUIDE_DEFAULT_LOOP_POLICY } from 'src/guide/release/guide-release.bundle';
import { ArmLearningMetrics, learningGuard } from '../../evals/gate';
import {
  ArmStats,
  CanaryEvidence,
  CriterionArms,
  decideCanary,
} from '../canary-decision';

const policy = GUIDE_DEFAULT_LOOP_POLICY;

const arm = (over: Partial<ArmStats> = {}): ArmStats => ({
  threads: 500,
  turns: 3000,
  failureRate: 0.01,
  ratedTurns: 400,
  judgedWindows: 300,
  safetyFailureWindows: 0,
  ...over,
});

const crit = (
  id: string,
  gaFail: number,
  canaryFail: number,
  judged = 100,
): CriterionArms => ({
  id,
  ga: { fail: gaFail, judged },
  canary: { fail: canaryFail, judged },
});

const pass = { status: 'pass' as const, reason: 'learning kept pace' };

const evidence = (over: Partial<CanaryEvidence> = {}): CanaryEvidence => ({
  daysRunning: 5,
  ga: arm(),
  canary: arm({ threads: 150, turns: 900, ratedTurns: 120, judgedWindows: 90 }),
  criteria: [crit('warmth', 10, 9), crit('grounding', 8, 8)],
  trusted: ['warmth', 'grounding'],
  guard: pass,
  ...over,
});

describe('decideCanary (Appendix A "Learning loop")', () => {
  it('promotes once every threshold is met and no trusted criterion is worse', () => {
    const decision = decideCanary(evidence(), policy);
    expect(decision.action).toBe('promote');
    expect(decision.ready).toBe(true);
  });

  it('waits until 4 days, 120 threads, 80 judged windows and 100 rated turns', () => {
    const cases: Array<[Partial<CanaryEvidence>, string]> = [
      [{ daysRunning: 3.9 }, 'days'],
      [
        { canary: arm({ threads: 119, ratedTurns: 120, judgedWindows: 90 }) },
        'threads',
      ],
      [
        { canary: arm({ threads: 150, ratedTurns: 120, judgedWindows: 79 }) },
        'judgedWindows',
      ],
      [
        { canary: arm({ threads: 150, ratedTurns: 99, judgedWindows: 90 }) },
        'ratedTurns',
      ],
    ];
    for (const [over, missing] of cases) {
      const decision = decideCanary(evidence(over), policy);
      expect(decision.action).toBe('wait');
      expect(decision.thresholds[missing].met).toBe(false);
    }
  });

  it('reverts an inconclusive canary at 14 days', () => {
    const decision = decideCanary(
      evidence({
        daysRunning: 14,
        canary: arm({ threads: 30, ratedTurns: 10, judgedWindows: 5 }),
      }),
      policy,
    );
    expect(decision.action).toBe('revert');
    expect(decision.reasons[0]).toMatch(/inconclusive after 14 days/);
  });

  it('decides on κ-trusted criteria only', () => {
    // autonomy is far worse on the canary, but people and the critic do not agree on it yet.
    const untrusted = decideCanary(
      evidence({
        criteria: [crit('warmth', 10, 9), crit('autonomy', 5, 60)],
        trusted: ['warmth'],
      }),
      policy,
    );
    expect(untrusted.action).toBe('promote');
    expect(untrusted.criteria.map((c) => c.id)).toEqual(['warmth']);

    const trusted = decideCanary(
      evidence({
        criteria: [crit('warmth', 10, 9), crit('autonomy', 5, 60)],
        trusted: ['warmth', 'autonomy'],
      }),
      policy,
    );
    expect(trusted.action).toBe('revert');
    expect(trusted.reasons[0]).toMatch(/^autonomy/);
  });

  it('cannot promote with nothing trusted to judge by', () => {
    const decision = decideCanary(evidence({ trusted: [] }), policy);
    expect(decision.action).toBe('wait');
    expect(decision.reasons.join()).toMatch(/no criterion is trusted/);
  });

  it('reverts on harm before any threshold: safety failures above GA, emergency', () => {
    const decision = decideCanary(
      evidence({
        daysRunning: 0.5,
        canary: arm({
          threads: 10,
          judgedWindows: 20,
          safetyFailureWindows: 2,
        }),
        ga: arm({ judgedWindows: 300, safetyFailureWindows: 1 }),
      }),
      policy,
    );
    expect(decision.action).toBe('revert');
    expect(decision.emergency).toBe(true);
  });

  it('reverts on turn failures well above GA', () => {
    const decision = decideCanary(
      evidence({
        daysRunning: 1,
        canary: arm({ turns: 80, failureRate: 0.12 }),
      }),
      policy,
    );
    expect(decision.action).toBe('revert');
    expect(decision.emergency).toBe(false);
  });
});

describe('the learning-metric guard on the canary (plan §4.13)', () => {
  const metrics = (
    over: Partial<ArmLearningMetrics> & Pick<ArmLearningMetrics, 'arm'>,
  ): ArmLearningMetrics => ({
    threads: 200,
    thumbsUp: 80,
    thumbsDown: 20,
    quizFirstAttempts: 60,
    quizFirstAttemptPassRate: 0.7,
    itemsCompletedPerThread: 2,
    ...over,
  });

  it('reverts when engagement rises while learning is flat', () => {
    const guard = learningGuard(
      metrics({ arm: 'ga' }),
      metrics({
        arm: 'canary',
        itemsCompletedPerThread: 2.6,
        quizFirstAttemptPassRate: 0.7,
      }),
    );
    expect(guard.status).toBe('fail');
    const decision = decideCanary(evidence({ guard, daysRunning: 1 }), policy);
    expect(decision.action).toBe('revert');
    expect(decision.reasons[0]).toMatch(/learning guard: engagement rose/);
  });

  it('reverts when engagement rises while learning falls', () => {
    const guard = learningGuard(
      metrics({ arm: 'ga' }),
      metrics({
        arm: 'canary',
        thumbsUp: 95,
        thumbsDown: 5,
        quizFirstAttemptPassRate: 0.6,
      }),
    );
    expect(guard.status).toBe('fail');
    expect(decideCanary(evidence({ guard }), policy).action).toBe('revert');
  });

  it('promotes when learning rises with engagement', () => {
    const guard = learningGuard(
      metrics({ arm: 'ga' }),
      metrics({
        arm: 'canary',
        itemsCompletedPerThread: 2.6,
        quizFirstAttemptPassRate: 0.78,
      }),
    );
    expect(guard.status).toBe('pass');
    expect(decideCanary(evidence({ guard }), policy).action).toBe('promote');
  });

  it('a pending guard (too few quiz attempts) holds the promotion, then reverts at 14 days', () => {
    const guard = learningGuard(
      metrics({ arm: 'ga' }),
      metrics({ arm: 'canary', quizFirstAttempts: 5 }),
    );
    expect(guard.status).toBe('pending');
    expect(decideCanary(evidence({ guard }), policy).action).toBe('wait');
    expect(
      decideCanary(evidence({ guard, daysRunning: 15 }), policy).action,
    ).toBe('revert');
  });
});
