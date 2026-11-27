import {
  blueprintMinutes,
  lengthBounds,
  lengthProblems,
  lengthWarning,
  realisticMinutes,
} from '../course-pilot-length.util';

const plan = (...minutes: number[]): any => ({
  sections: [
    {
      title: 'S1',
      items: minutes.map((m, i) => ({
        id: `i${i}`,
        type: i === 0 ? 'ROLEPLAY' : 'ARTICLE',
        title: `Item ${i}`,
        estimatedMinutes: m,
      })),
    },
  ],
});
const brief = (durationMinutes?: number): any => ({
  shape: durationMinutes ? { durationMinutes } : {},
});

describe('Course Pilot length check', () => {
  it('allows 10% either side, at least 2 minutes', () => {
    expect(lengthBounds(60)).toEqual({ min: 54, max: 66 });
    expect(lengthBounds(15)).toEqual({ min: 13, max: 17 });
  });

  it('passes a plan within the bounds', () => {
    expect(lengthProblems(plan(30, 20, 15), brief(60))).toEqual([]);
    expect(lengthProblems(plan(30, 24), brief(60))).toEqual([]);
  });

  it('flags a plan that runs long, naming the largest items', () => {
    const [problem] = lengthProblems(plan(40, 20, 11), brief(60));
    expect(blueprintMinutes(plan(40, 20, 11))).toBe(71);
    expect(problem).toContain('60-minute course');
    expect(problem).toContain('71 minutes');
    expect(problem).toContain('between 54 and 66');
    expect(problem).toContain('cutting about 11 minutes');
    expect(problem).toContain('"Item 0" (ROLEPLAY, 40 min)');
  });

  it('flags a plan that runs short', () => {
    const [problem] = lengthProblems(plan(50, 50), brief(120));
    expect(problem).toContain('adding about 20 minutes');
  });

  it('counts a squeezed estimate at its floor and names it', () => {
    // A 3-minute roleplay counts as 6 (half the usual 12): 3+25+25 = 53 looks fine, 56 is not.
    const squeezed = plan(3, 25, 25);
    expect(realisticMinutes(squeezed)).toBe(56);
    expect(lengthProblems(squeezed, brief(50))).toHaveLength(1);
    expect(lengthProblems(squeezed, brief(50))[0]).toContain(
      '"Item 0" (ROLEPLAY, 3 min; at least 6)',
    );
  });

  it('checks nothing when the trainer gave no length', () => {
    expect(lengthProblems(plan(200), brief())).toEqual([]);
    expect(lengthProblems(plan(200), null)).toEqual([]);
  });

  it('warns the trainer in plain words', () => {
    expect(lengthWarning(plan(40, 20, 11), brief(60))).toEqual([
      'This plan is about 71 minutes; you asked for 60. Ask me to shorten or lengthen it, or approve it as it is.',
    ]);
    expect(lengthWarning(plan(30, 30), brief(60))).toEqual([]);
  });
});
