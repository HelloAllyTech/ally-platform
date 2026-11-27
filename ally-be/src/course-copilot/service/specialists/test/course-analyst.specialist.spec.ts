import {
  COURSE_ANALYST_MAX_SUGGESTIONS,
  normaliseAnalystResult,
} from '../course-analyst.specialist';

const facts = ['i1'];

describe('Course Analyst', () => {
  it('keeps known item ids and known kinds, drops empty changes', () => {
    const result = normaliseAnalystResult(
      {
        summary: 'Most finish; one question trips people up.',
        suggestions: [
          {
            itemId: 'i1',
            signal: 'hard question',
            cause: 'The key may be wrong.',
            change: 'Check the answer key of question 1.',
            kind: 'check_key',
          },
          { itemId: 'i9', change: 'Shorten it.', kind: 'banana' },
          { change: '' },
        ],
      },
      facts,
    );
    expect(result.summary).toBe('Most finish; one question trips people up.');
    expect(result.suggestions).toEqual([
      {
        itemId: 'i1',
        signal: 'hard question',
        cause: 'The key may be wrong.',
        change: 'Check the answer key of question 1.',
        kind: 'check_key',
      },
      { signal: '', cause: '', change: 'Shorten it.', kind: 'reword' },
    ]);
  });

  it(`keeps at most ${COURSE_ANALYST_MAX_SUGGESTIONS} suggestions`, () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ change: `c${i}` }));
    expect(
      normaliseAnalystResult({ suggestions: many }, facts).suggestions,
    ).toHaveLength(COURSE_ANALYST_MAX_SUGGESTIONS);
  });
});
