import {
  baselineOf,
  jaccard,
  judgeDrift,
  NightlyRun,
  nightlyAlerts,
  nightlyMetrics,
  sameness,
  trigrams,
} from '../util/debrief-nightly.util';

const T = {
  lengthCreepShare: 0.2,
  samenessMax: 0.6,
  specificityDrop: 0.5,
  gapMax: 1,
};

function run(
  i: number,
  over: Partial<NightlyRun> = {},
  lead = `Point ${i}`,
  words = 50,
): NightlyRun {
  return {
    id: `r${i}`,
    learnerId: i,
    language: 'en',
    recipeKey: 'standard',
    status: 'published',
    evaluatorOverall: 9,
    judgeOverall: 8.5,
    judgeSpecificity: 8,
    cards: {
      opening: Array.from({ length: words }, (_, k) => `w${k}`).join(' '),
      what_worked: [{ skill: 's', turn_index: 1, quote: 'q', lead, body: 'b' }],
      work_on_this: [],
      skill_words: [],
      reflective_question: '',
    } as any,
    ...over,
  };
}

describe('nightly check measures', () => {
  it('counts words, quotes, the judge’s specificity and the gap', () => {
    const m = nightlyMetrics([run(1), run(2), run(3)]);
    expect(m.runs).toBe(3);
    expect(m.wordsP50).toBeGreaterThan(50);
    expect(m.quotesPerDebrief).toBe(1);
    expect(m.specificity).toBe(8);
    expect(m.evaluatorJudgeGap).toBe(0.5);
  });

  it('sameness compares any script, and only across learners', () => {
    const hi = 'आपने क्लाइंट की भावना को बहुत ध्यान से सुना';
    expect(jaccard(trigrams(hi), trigrams(hi))).toBe(1);
    // Two learners with the same line: high. One learner twice: not counted.
    expect(
      sameness([
        { learnerId: 1, lines: [hi] },
        { learnerId: 2, lines: [hi] },
      ]),
    ).toBe(1);
    expect(
      sameness([
        { learnerId: 1, lines: [hi] },
        { learnerId: 1, lines: [hi] },
      ]),
    ).toBeNull();
    expect(
      sameness([
        { learnerId: 1, lines: ['You stayed with her feeling'] },
        { learnerId: 2, lines: ['Ask about the exam plan next'] },
      ]),
    ).toBeLessThan(0.3);
  });
});

describe('nightly check alerts', () => {
  const day = (over: Partial<ReturnType<typeof nightlyMetrics>>) => ({
    runs: 10,
    wordsP50: 200,
    wordsP90: 260,
    quotesPerDebrief: 3,
    sameness: 0.3,
    specificity: 8,
    evaluatorJudgeGap: 0.2,
    ...over,
  });
  const base = baselineOf([day({}), day({}), day({})]);

  it('raises nothing on an ordinary day', () => {
    expect(nightlyAlerts(day({}), base, T)).toEqual([]);
  });

  it('a planted length increase raises length creep', () => {
    const a = nightlyAlerts(day({ wordsP50: 260 }), base, T);
    expect(a.map((x) => x.code)).toEqual(['length_creep']);
    expect(a[0].detail).toContain('260 words');
  });

  it('flags sameness, vaguer debriefs and a gap between the checks', () => {
    const a = nightlyAlerts(
      day({ sameness: 0.7, specificity: 7.2, evaluatorJudgeGap: 1.4 }),
      base,
      T,
    );
    expect(a.map((x) => x.code).sort()).toEqual(
      ['evaluator_judge_gap', 'sameness', 'vaguer'].sort(),
    );
  });

  it('stays quiet on a day with too few debriefs', () => {
    expect(nightlyAlerts(day({ runs: 3, wordsP50: 999 }), base, T)).toEqual([]);
  });

  it('with no history yet, only absolute limits can alert', () => {
    expect(
      nightlyAlerts(day({ wordsP50: 999, sameness: 0.9 }), {}, T).map(
        (x) => x.code,
      ),
    ).toEqual(['sameness']);
  });
});

describe('judge drift', () => {
  it('is the mean move over the re-scored debriefs, from 10 up', () => {
    const pairs = Array.from({ length: 12 }, () => ({ before: 8, after: 8.4 }));
    expect(judgeDrift(pairs)).toEqual({ drift: 0.4, n: 12 });
    expect(judgeDrift(pairs.slice(0, 9))).toBeNull();
  });
});
