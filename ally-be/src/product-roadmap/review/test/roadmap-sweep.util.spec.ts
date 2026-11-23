import { isSweepCandidate, SweepCandidate } from '../roadmap-sweep.util';

const NOW = new Date('2026-11-19T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const idea = (over: Partial<SweepCandidate> = {}): SweepCandidate => ({
  id: 'i',
  createdAt: daysAgo(90),
  voters: 1,
  shownStage: 'accepted',
  hasLead: false,
  kept: false,
  ...over,
});

describe('isSweepCandidate (idea-to-plan audit rec 9)', () => {
  it('pulls up an old To do idea with at most one voter', () => {
    expect(isSweepCandidate(idea(), NOW)).toBe(true);
    expect(
      isSweepCandidate(idea({ voters: 0, shownStage: 'submitted' }), NOW),
    ).toBe(true);
  });

  it.each([
    ['younger than 60 days', { createdAt: daysAgo(59) }],
    ['two voters', { voters: 2 }],
    ['being planned', { shownStage: 'planning' }],
    ['declined already', { shownStage: 'declined' }],
    ['led by a builder', { hasLead: true }],
    ['kept by an Owner', { kept: true }],
  ])('leaves out an idea %s', (_why, over) => {
    expect(isSweepCandidate(idea(over as Partial<SweepCandidate>), NOW)).toBe(
      false,
    );
  });
});
