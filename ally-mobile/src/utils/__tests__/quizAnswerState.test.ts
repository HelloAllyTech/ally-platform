import {SanitizedQuizQuestion} from '@/types';

import {
  initialAnswerState,
  isAnswered,
  toAnswerInput,
  wordCount,
} from '../quizAnswerState';

const buildQuestion = (
  overrides: Partial<SanitizedQuizQuestion>,
): SanitizedQuizQuestion => ({
  id: 'q1',
  type: 'mcq_single',
  prompt: 'Prompt',
  points: 1,
  ...overrides,
});

describe('initialAnswerState', () => {
  it('seeds ordering with the given (pre-shuffled) item order', () => {
    const question = buildQuestion({
      type: 'ordering',
      items: [{id: 'a', text: 'A'}, {id: 'b', text: 'B'}],
    });
    expect(initialAnswerState(question)).toEqual({orderedItemIds: ['a', 'b']});
  });

  it('seeds matching with an empty pairs array', () => {
    expect(initialAnswerState(buildQuestion({type: 'matching'}))).toEqual({pairs: []});
  });

  it('seeds fill_blank with an empty blanks map', () => {
    expect(initialAnswerState(buildQuestion({type: 'fill_blank'}))).toEqual({blanks: {}});
  });

  it('seeds likert_scale with an empty ratings map', () => {
    expect(initialAnswerState(buildQuestion({type: 'likert_scale'}))).toEqual({
      ratings: {},
    });
  });

  it('is an empty object for other types', () => {
    expect(initialAnswerState(buildQuestion({type: 'mcq_single'}))).toEqual({});
    expect(initialAnswerState(buildQuestion({type: 'true_false'}))).toEqual({});
    expect(initialAnswerState(buildQuestion({type: 'open_ended'}))).toEqual({});
  });
});

describe('toAnswerInput', () => {
  it('serializes mcq selections', () => {
    const question = buildQuestion({type: 'mcq_multi'});
    expect(toAnswerInput(question, {selectedOptionIds: ['a', 'b']})).toEqual({
      questionId: 'q1',
      selectedOptionIds: ['a', 'b'],
    });
  });

  it('serializes a true_false answer', () => {
    const question = buildQuestion({type: 'true_false'});
    expect(toAnswerInput(question, {booleanAnswer: true})).toEqual({
      questionId: 'q1',
      booleanAnswer: true,
    });
  });

  it('serializes an ordering answer', () => {
    const question = buildQuestion({type: 'ordering'});
    expect(toAnswerInput(question, {orderedItemIds: ['b', 'a']})).toEqual({
      questionId: 'q1',
      orderedItemIds: ['b', 'a'],
    });
  });

  it('serializes matching pairs', () => {
    const question = buildQuestion({type: 'matching'});
    expect(
      toAnswerInput(question, {pairs: [{leftId: 'l1', rightId: 'r1'}]}),
    ).toEqual({
      questionId: 'q1',
      pairs: [{leftId: 'l1', rightId: 'r1'}],
    });
  });

  it('serializes fill_blank answers as a blankId/answer array', () => {
    const question = buildQuestion({type: 'fill_blank'});
    expect(
      toAnswerInput(question, {blanks: {b1: 'cat', b2: 'dog'}}),
    ).toEqual({
      questionId: 'q1',
      blanks: [
        {blankId: 'b1', answer: 'cat'},
        {blankId: 'b2', answer: 'dog'},
      ],
    });
  });

  it('serializes an open_ended answer', () => {
    const question = buildQuestion({type: 'open_ended'});
    expect(toAnswerInput(question, {text: 'my answer'})).toEqual({
      questionId: 'q1',
      text: 'my answer',
    });
  });

  it('serializes likert ratings as a statementId/scaleOptionId array', () => {
    const question = buildQuestion({type: 'likert_scale'});
    expect(
      toAnswerInput(question, {ratings: {s1: 'sc1', s2: 'sc3'}}),
    ).toEqual({
      questionId: 'q1',
      ratings: [
        {statementId: 's1', scaleOptionId: 'sc1'},
        {statementId: 's2', scaleOptionId: 'sc3'},
      ],
    });
  });

  it('serializes an empty likert answer as an empty ratings array', () => {
    const question = buildQuestion({type: 'likert_scale'});
    expect(toAnswerInput(question, {})).toEqual({
      questionId: 'q1',
      ratings: [],
    });
  });
});

describe('isAnswered', () => {
  it('mcq requires at least one selection', () => {
    const question = buildQuestion({type: 'mcq_single'});
    expect(isAnswered(question, {})).toBe(false);
    expect(isAnswered(question, {selectedOptionIds: []})).toBe(false);
    expect(isAnswered(question, {selectedOptionIds: ['a']})).toBe(true);
  });

  it('true_false requires a defined boolean (false counts as answered)', () => {
    const question = buildQuestion({type: 'true_false'});
    expect(isAnswered(question, {})).toBe(false);
    expect(isAnswered(question, {booleanAnswer: false})).toBe(true);
    expect(isAnswered(question, {booleanAnswer: true})).toBe(true);
  });

  it('ordering requires a non-empty order', () => {
    const question = buildQuestion({type: 'ordering'});
    expect(isAnswered(question, {orderedItemIds: []})).toBe(false);
    expect(isAnswered(question, {orderedItemIds: ['a']})).toBe(true);
  });

  it('matching requires at least one pair', () => {
    const question = buildQuestion({type: 'matching'});
    expect(isAnswered(question, {pairs: []})).toBe(false);
    expect(isAnswered(question, {pairs: [{leftId: 'l1', rightId: 'r1'}]})).toBe(true);
  });

  it('fill_blank requires every declared blank to be non-empty', () => {
    const question = buildQuestion({type: 'fill_blank', blankIds: ['b1', 'b2']});
    expect(isAnswered(question, {blanks: {b1: 'x'}})).toBe(false);
    expect(isAnswered(question, {blanks: {b1: 'x', b2: '  '}})).toBe(false);
    expect(isAnswered(question, {blanks: {b1: 'x', b2: 'y'}})).toBe(true);
  });

  it('open_ended requires non-whitespace text', () => {
    const question = buildQuestion({type: 'open_ended'});
    expect(isAnswered(question, {text: '   '})).toBe(false);
    expect(isAnswered(question, {text: 'hello'})).toBe(true);
  });

  it('likert_scale requires every statement to be rated', () => {
    const question = buildQuestion({
      type: 'likert_scale',
      statements: [{id: 's1', text: 'A'}, {id: 's2', text: 'B'}],
    });
    expect(isAnswered(question, {})).toBe(false);
    expect(isAnswered(question, {ratings: {s1: 'sc1'}})).toBe(false);
    expect(
      isAnswered(question, {ratings: {s1: 'sc1', s2: 'sc2'}}),
    ).toBe(true);
  });
});

describe('wordCount', () => {
  it('is 0 for empty/whitespace text', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });

  it('counts whitespace-delimited words', () => {
    expect(wordCount('one two three')).toBe(3);
    expect(wordCount('  leading and trailing  ')).toBe(3);
  });
});
