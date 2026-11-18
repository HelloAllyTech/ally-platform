import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { planAttention, stepFixVerdict } from '../plan-attention.util';

const step = (overrides: Partial<BugFinding>): BugFinding =>
  ({
    id: 'step-1',
    stepIndex: 1,
    repo: 'ally-ai',
    status: BugFindingStatus.PR_OPENED,
    prUrl: 'https://github.com/HelloAllyTech/ally-platform/pull/80',
    metadata: null,
    ...overrides,
  }) as BugFinding;

const verdict = (v: 'pass' | 'fail', prUrl = step({}).prUrl) => ({
  verdict: v,
  prUrl,
  prHeadSha: null,
  at: '2026-10-26T12:15:56.000Z',
  checks: [],
});

describe('planAttention', () => {
  const parent = { status: BugFindingStatus.COORDINATING };

  it('asks for a merge when the open step passed the Verifier (PR #80, 2026-10-26)', () => {
    const attention = planAttention(parent, [
      step({ id: 'done', stepIndex: 0, status: BugFindingStatus.RELEASED }),
      step({ metadata: { fixVerdicts: [verdict('pass')] } }),
    ]);
    expect(attention).toEqual({
      kind: 'merge',
      stepId: 'step-1',
      stepIndex: 1,
      repo: 'ally-ai',
      prUrl: 'https://github.com/HelloAllyTech/ally-platform/pull/80',
    });
  });

  it('asks for a review when the Verifier refused the open step (PR #74)', () => {
    expect(
      planAttention(parent, [
        step({ metadata: { fixVerdicts: [verdict('fail')] } }),
      ])?.kind,
    ).toBe('review');
  });

  it("is quiet while the Verifier has not spoken — that is still Bug Hunter's turn", () => {
    expect(planAttention(parent, [step({})])).toBeNull();
  });

  it('is quiet when no step has an open PR, and on anything but a coordinating parent', () => {
    expect(
      planAttention(parent, [step({ status: BugFindingStatus.FIXING })]),
    ).toBeNull();
    expect(
      planAttention({ status: BugFindingStatus.PR_OPENED }, [
        step({ metadata: { fixVerdicts: [verdict('pass')] } }),
      ]),
    ).toBeNull();
  });

  it('reads the verdict for the current PR only', () => {
    const stale = verdict(
      'fail',
      'https://github.com/HelloAllyTech/ally-platform/pull/9',
    );
    expect(
      stepFixVerdict(step({ metadata: { fixVerdicts: [stale] } })),
    ).toBeNull();
    expect(
      stepFixVerdict(
        step({ metadata: { fixVerdicts: [stale, verdict('pass')] } }),
      ),
    ).toBe('pass');
  });
});
