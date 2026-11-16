import { builderDelivery } from '../util/debrief-builder-progress.util';
import { ideaState } from '../util/debrief-console-view.util';
import { istMonthsBack, monthOf } from '../util/debrief-pm-reports.util';

const pr = (over: Record<string, unknown> = {}) => ({
  repo: 'ally-platform',
  prNumber: 7,
  merged: true,
  state: 'closed',
  mergedAt: '2026-11-10T10:00:00Z',
  releaseState: 'released',
  releasedAt: '2026-11-11T09:00:00Z',
  releaseTag: 'be-v1.200.0',
  ...over,
});

describe('builderDelivery', () => {
  it('is delivered when every merged PR reached production', () => {
    expect(
      builderDelivery([
        pr(),
        pr({
          prNumber: 8,
          releasedAt: '2026-11-12T09:00:00Z',
          releaseTag: 'frontend-v1.7.0',
        }),
      ]),
    ).toEqual({
      at: '2026-11-12T09:00:00.000Z',
      releaseTags: ['be-v1.200.0', 'frontend-v1.7.0'],
      pullRequests: [
        { repo: 'ally-platform', number: 7 },
        { repo: 'ally-platform', number: 8 },
      ],
    });
  });

  it('a repo with no release pipeline counts from the merge', () => {
    expect(
      builderDelivery([
        pr({ releaseState: 'skipped', releasedAt: null, releaseTag: null }),
      ])?.at,
    ).toBe('2026-11-10T10:00:00.000Z');
  });

  it('waits while a PR is open, releasing, or failed', () => {
    expect(
      builderDelivery([pr(), pr({ merged: false, state: 'open' })]),
    ).toBeNull();
    expect(builderDelivery([pr({ releaseState: 'releasing' })])).toBeNull();
    expect(builderDelivery([pr({ releaseState: 'failed' })])).toBeNull();
    expect(
      builderDelivery([pr({ merged: false, state: 'closed' })]),
    ).toBeNull();
  });
});

describe('a delivered Builder idea is being tested until measured', () => {
  const idea = (evidence: Record<string, unknown>) => ({
    status: 'approved',
    change: { ideaKind: 'needs_code' },
    evidence: {
      handoff: { kind: 'builder', status: 'filed', filedId: 's1' },
      forecast: { metric: 'judge_median', direction: 'up', baseline: 8 },
      ...evidence,
    },
  });

  it('handed off: closed', () => {
    expect(ideaState(idea({})).state).toBe('closed');
  });
  it('delivered: open (Being tested)', () => {
    expect(
      ideaState(idea({ delivery: { at: '2026-11-12T00:00:00Z' } })).state,
    ).toBe('open');
  });
  it('measured: closed again, with its outcome on the card', () => {
    expect(
      ideaState(
        idea({
          delivery: { at: '2026-11-12T00:00:00Z' },
          forecast: {
            metric: 'judge_median',
            checkedAt: '2026-11-26T00:00:00Z',
          },
        }),
      ).closedReason,
    ).toBe('handed_off');
  });
});

describe('India-time months', () => {
  it('a moment late on the 30th UTC is already next month in India', () => {
    const at = new Date('2026-11-30T20:00:00Z');
    expect(monthOf(at)).toBe('2026-12');
    expect(istMonthsBack(0, at).toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(monthOf(istMonthsBack(1, at))).toBe('2026-11');
  });
});
