import {
  ROADMAP_QUALITY_DIMENSIONS,
  ROADMAP_QUALITY_PASS_SCORE,
} from '../../constants/product-roadmap.constants';
import {
  gradeQuality,
  isSingleIdeaEffort,
  normaliseSlices,
} from '../../util/roadmap-quality.util';

const scores = (s: Record<string, number>) =>
  ROADMAP_QUALITY_DIMENSIONS.map((d) => ({
    id: d.id,
    score: s[d.id] ?? 0,
    note: `${d.id} note`,
  }));
const all = (n: number) =>
  scores(Object.fromEntries(ROADMAP_QUALITY_DIMENSIONS.map((d) => [d.id, n])));

describe('quality dimensions', () => {
  it('weights sum to 100, so the score really is out of 100', () => {
    expect(ROADMAP_QUALITY_DIMENSIONS.reduce((s, d) => s + d.weight, 0)).toBe(
      100,
    );
  });
});

describe('gradeQuality', () => {
  it('fails closed on nothing, garbage and a missing dimension', () => {
    for (const bad of [undefined, null, 'great', {}, [{ id: 7 }]]) {
      const q = gradeQuality(bad);
      expect(q.score).toBe(0);
      expect(q.passed).toBe(false);
      expect(q.dimensions).toHaveLength(ROADMAP_QUALITY_DIMENSIONS.length);
      expect(q.dimensions[0].note).toBe('Not assessed yet.');
    }
  });

  it('computes the total itself and clamps what the model sends', () => {
    const q = gradeQuality([
      { id: 'problem', score: 99, note: 'x' },
      { id: 'audience', score: -3, note: 'x' },
      { id: 'outcome', score: '3', note: 'x' },
      { id: 'strategy', score: 2.6, note: 'x' },
      { id: 'made-up', score: 4 },
    ]);
    const by = Object.fromEntries(q.dimensions.map((d) => [d.id, d.score]));
    expect(by).toMatchObject({
      problem: 4,
      audience: 0,
      outcome: 3,
      strategy: 3,
    });
    expect(
      q.dimensions.find((d) => d.id === ('made-up' as string)),
    ).toBeUndefined();
  });

  it('adequate everywhere does not pass; specific everywhere does', () => {
    expect(gradeQuality(all(2)).score).toBe(50);
    expect(gradeQuality(all(2)).passed).toBe(false);
    expect(gradeQuality(all(3)).score).toBe(75);
    expect(gradeQuality(all(3)).passed).toBe(true);
  });

  it('lets an idea with only the author’s own observation as evidence pass when sharp elsewhere', () => {
    const q = gradeQuality(
      scores({
        problem: 3,
        audience: 3,
        outcome: 3,
        strategy: 3,
        evidence: 1,
        scope: 3,
      }),
    );
    expect(q.score).toBe(67.5);
    expect(q.passed).toBe(true);
  });

  it('does not let a high total hide a floored dimension', () => {
    const q = gradeQuality(
      scores({
        problem: 4,
        audience: 4,
        outcome: 1,
        strategy: 4,
        evidence: 4,
        scope: 4,
      }),
    );
    expect(q.score).toBeGreaterThanOrEqual(ROADMAP_QUALITY_PASS_SCORE);
    expect(q.passed).toBe(false);
    expect(q.weakest).toBe('outcome');
  });

  it('names the biggest weighted gap as the weakest, and null at full marks', () => {
    expect(
      gradeQuality(
        scores({
          problem: 4,
          audience: 4,
          outcome: 4,
          strategy: 4,
          evidence: 0,
          scope: 3,
        }),
      ).weakest,
    ).toBe('evidence');
    expect(gradeQuality(all(4)).weakest).toBeNull();
  });

  it('keeps one decimal so 64.9 never rounds up to a pass', () => {
    // 3,3,3,3 on the weighty four = 56.25; evidence 1 + scope 1 = 3.75 + 2.5 → 62.5, not a pass.
    const q = gradeQuality(
      scores({
        problem: 3,
        audience: 3,
        outcome: 3,
        strategy: 3,
        evidence: 1,
        scope: 1,
      }),
    );
    expect(q.score).toBe(62.5);
    expect(q.passed).toBe(false);
  });
});

describe('isSingleIdeaEffort', () => {
  it('allows S, M, L and nothing else', () => {
    expect(['s', 'm', 'l'].every(isSingleIdeaEffort)).toBe(true);
    expect(['xl', 'xxl', '', null, undefined, 3].some(isSingleIdeaEffort)).toBe(
      false,
    );
  });
});

describe('normaliseSlices', () => {
  const limits = { descriptionMax: 900, titleMax: 80 };
  const slice = (over: Record<string, unknown> = {}) => ({
    title: ' Reminders  that land ',
    description: 'As a counsellor, I miss sessions — so that I show up.',
    effort: 'M',
    productGoal: 'Retention',
    ...over,
  });

  it('keeps a valid split, cleans it, and drops unknown goals to null', () => {
    const out = normaliseSlices(
      [slice(), slice({ productGoal: 'Nope', effort: 's', title: '' })],
      ['Retention'],
      limits,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Reminders that land', effort: 'm' });
    expect(out[1]).toMatchObject({ title: null, productGoal: null });
  });

  it('is all or nothing: one blank or still-too-big slice voids the split', () => {
    expect(
      normaliseSlices([slice(), slice({ effort: 'xl' })], [], limits),
    ).toEqual([]);
    expect(
      normaliseSlices([slice(), slice({ description: ' ' })], [], limits),
    ).toEqual([]);
  });

  it('needs between two and five slices', () => {
    expect(normaliseSlices([slice()], [], limits)).toEqual([]);
    expect(normaliseSlices(Array(6).fill(slice()), [], limits)).toEqual([]);
    expect(normaliseSlices(Array(5).fill(slice()), [], limits)).toHaveLength(5);
    expect(normaliseSlices('x', [], limits)).toEqual([]);
  });
});
