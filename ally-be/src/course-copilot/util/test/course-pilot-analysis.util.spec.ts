import { LearnerResults } from '../../service/course-copilot-learner-results.service';
import { analysisSignals } from '../course-pilot-analysis.util';

const item = (over: any = {}) => ({
  itemId: 'i1',
  section: 1,
  type: 'ARTICLE',
  title: 'Read',
  reached: 10,
  completed: 10,
  completionPct: 100,
  avgAttempts: 1,
  avgScore: null,
  medianMinutes: 5,
  notes: [],
  ...over,
});

const results = (over: Partial<LearnerResults> = {}): LearnerResults => ({
  trackId: 't1',
  enrolled: 10,
  started: 10,
  completed: 8,
  medianDaysToComplete: 3,
  items: [item()],
  withheld: 0,
  ...over,
});

describe('Course Pilot analysis signals', () => {
  it('measures nothing below five learners', () => {
    expect(analysisSignals(results({ enrolled: 4, completed: 0 }))).toEqual([]);
  });

  it('raises nothing for a course that is going well', () => {
    expect(analysisSignals(results())).toEqual([]);
  });

  it('finds low completion, the drop-off, a stalling item, a hard question and a hard pass', () => {
    const signals = analysisSignals(
      results({
        enrolled: 20,
        completed: 4,
        items: [
          item({ itemId: 'a', title: 'Intro', reached: 20, completed: 20 }),
          item({
            itemId: 'b',
            title: 'Jamie',
            type: 'ROLEPLAY',
            reached: 12,
            completed: 6,
            completionPct: 50,
            avgAttempts: 3.2,
            avgScore: 71,
          }),
          item({
            itemId: 'c',
            title: 'Check',
            type: 'QUIZ',
            reached: 6,
            completed: 6,
            notes: [
              'most missed on first try: "Best next move?" (17% right); "Easy one" (83% right)',
            ],
          }),
        ],
      }),
    );
    expect(signals.map((s) => s.kind)).toEqual([
      'low_completion',
      'drop_off',
      'stall',
      'hard_question',
      'hard_to_pass',
    ]);
    expect(signals[0].text).toBe(
      '4 of 20 enrolled learners (20%) finished the course.',
    );
    expect(signals[1]).toMatchObject({ itemId: 'b' });
    expect(signals[1].text).toContain('8 learners finished "Intro"');
    expect(signals[2].text).toContain('6 of 12 learners who reached it');
    expect(signals[3]).toMatchObject({ itemId: 'c' });
    expect(signals[3].text).toContain('only 17% got "Best next move?"');
    expect(signals[4].text).toContain('3.2 attempts on average');
  });

  it('never compares an item whose numbers were withheld', () => {
    const signals = analysisSignals(
      results({
        enrolled: 20,
        completed: 15,
        items: [
          item({ itemId: 'a', reached: 20, completed: 20 }),
          // Withheld: fewer than five learners reached it.
          item({
            itemId: 'b',
            reached: 0,
            completed: 0,
            completionPct: null,
            avgAttempts: null,
          }),
        ],
      }),
    );
    expect(signals).toEqual([]);
  });
});
