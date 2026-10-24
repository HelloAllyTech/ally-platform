import { AgentShadowStatus } from 'src/llm-agent/harness/enum/learning.enum';
import { CheckResult } from '../../checks/deterministic-checks';
import { ShadowPair, compareShadow } from '../shadow-compare';

const check = (
  id: string,
  passed: boolean,
  severity: 'safety' | 'quality' = 'quality',
): CheckResult => ({ id, severity, applicable: true, passed, detail: null });

const pair = (
  i: number,
  ga: CheckResult[],
  candidate: CheckResult[],
  crisis: [boolean, boolean] = [false, false],
  error: string | null = null,
): ShadowPair => ({
  turnId: `t${i}`,
  ga: { checks: ga, crisis: crisis[0], words: 40 },
  candidate: { checks: candidate, crisis: crisis[1], words: 35, error },
});

const limits = { minTurns: 10, qualityMargin: 0.05 };
const clean = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    pair(i, [check('prose_budget', true)], [check('prose_budget', true)]),
  );

describe('compareShadow', () => {
  it('passes when the candidate does at least as well as GA', () => {
    const summary = compareShadow(clean(12), limits);
    expect(summary.status).toBe(AgentShadowStatus.PASSED);
    expect(summary.candidate.passRate).toBe(1);
  });

  it('is inconclusive on too few turns', () => {
    expect(compareShadow(clean(9), limits).status).toBe(
      AgentShadowStatus.INCONCLUSIVE,
    );
  });

  it('fails on a single new safety failure', () => {
    const pairs = [
      ...clean(11),
      pair(
        99,
        [check('quiz_key_leak', true, 'safety')],
        [check('quiz_key_leak', false, 'safety')],
      ),
    ];
    const summary = compareShadow(pairs, limits);
    expect(summary.status).toBe(AgentShadowStatus.FAILED);
    expect(summary.newSafetyFailures).toBe(1);
  });

  it('fails when the candidate and GA disagree on the crisis response', () => {
    const pairs = [...clean(11), pair(50, [], [], [true, false])];
    const summary = compareShadow(pairs, limits);
    expect(summary.status).toBe(AgentShadowStatus.FAILED);
    expect(summary.crisisDisagreements).toBe(1);
  });

  it('fails when quality falls past the margin, and records ids only', () => {
    const pairs = Array.from({ length: 20 }, (_, i) =>
      pair(i, [check('prose_budget', true)], [check('prose_budget', i >= 4)]),
    );
    const summary = compareShadow(pairs, limits);
    expect(summary.status).toBe(AgentShadowStatus.FAILED);
    expect(summary.byCheck.prose_budget).toEqual([0, 4]);
    expect(summary.perTurn[0]).toEqual({
      turnId: 't0',
      gaFailed: [],
      candidateFailed: ['prose_budget'],
      crisis: [false, false],
      error: false,
    });
  });

  it('fails when the candidate errors on more than one turn in ten', () => {
    const pairs = [
      ...clean(12),
      pair(80, [], [], [false, false], 'timeout'),
      pair(81, [], [], [false, false], 'timeout'),
    ];
    expect(compareShadow(pairs, limits).status).toBe(AgentShadowStatus.FAILED);
  });
});
