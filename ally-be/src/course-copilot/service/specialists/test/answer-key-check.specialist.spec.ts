import { QuizContent, QuizQuestionType } from 'src/track/type/quiz.type';
import {
  AnswerKeyCheckSpecialist,
  AnswerKeyDispute,
  answerKeyProblems,
  compareAnswerKey,
  normaliseSolverAnswers,
  questionsForSolver,
} from '../answer-key-check.specialist';
import { QuizSpecialist } from '../quiz.specialist';
import { SpecialistValidationError } from '../specialist.types';
import { fakeLlm, makeContext } from './specialist-test.fixtures';

const options = [
  { id: 'o1', text: 'Give advice straight away' },
  { id: 'o2', text: 'Reflect what you heard' },
  { id: 'o3', text: 'Share a story of your own' },
];

const quiz = (): QuizContent =>
  ({
    settings: {} as any,
    questions: [
      {
        id: 'q1',
        type: QuizQuestionType.MCQ_SINGLE,
        prompt: 'First move?',
        options,
        correctOptionIds: ['o2'],
        explanation: 'Reflect first.',
      },
      {
        id: 'q2',
        type: QuizQuestionType.MCQ_MULTI,
        prompt: 'Which help?',
        options,
        correctOptionIds: ['o2', 'o3'],
        explanation: 'Both.',
      },
      {
        id: 'q3',
        type: QuizQuestionType.TRUE_FALSE,
        prompt: 'Reassure early.',
        correctAnswer: false,
        explanation: 'It closes the conversation.',
      },
      {
        id: 'q4',
        type: QuizQuestionType.OPEN_ENDED,
        prompt: 'What do you write?',
        rubric: { guidance: 'g', criteria: [], maxScore: 10 },
      },
    ],
  }) as any;

const answers = (raw: unknown) => normaliseSolverAnswers(raw);

describe('questionsForSolver', () => {
  it('shows choice and true/false questions with lettered options, never the key', () => {
    const shown = questionsForSolver(quiz());
    expect(shown.map((q) => q.n)).toEqual([1, 2, 3]);
    expect(shown[0]).toEqual({
      n: 1,
      kind: 'single',
      question: 'First move?',
      options: [
        { letter: 'A', text: 'Give advice straight away' },
        { letter: 'B', text: 'Reflect what you heard' },
        { letter: 'C', text: 'Share a story of your own' },
      ],
    });
    expect(shown[2]).toEqual({
      n: 3,
      kind: 'true_false',
      question: 'Reassure early.',
    });
    const text = JSON.stringify(shown);
    expect(text).not.toContain('correct');
    expect(text).not.toContain('Reflect first.');
  });
});

describe('compareAnswerKey', () => {
  it('finds nothing when every answer matches the key', () => {
    const solved = answers({
      answers: [
        { n: 1, answer: ['B'] },
        { n: 2, answer: ['C', 'B'] },
        { n: 3, answer: [false] },
      ],
    });
    expect(compareAnswerKey(quiz(), solved)).toEqual([]);
  });

  it('disputes a different answer, a partial multi answer and a wrong true/false', () => {
    const solved = answers({
      answers: [
        { n: 1, answer: 'A', reason: 'Advice is safest.' },
        { n: 2, answer: ['B'] },
        { n: 3, answer: ['true'] },
      ],
    });
    const disputes = compareAnswerKey(quiz(), solved);
    expect(disputes.map((d) => [d.questionId, d.keyed, d.answered])).toEqual([
      ['q1', 'B "Reflect what you heard"', 'A "Give advice straight away"'],
      [
        'q2',
        'B "Reflect what you heard" + C "Share a story of your own"',
        'B "Reflect what you heard"',
      ],
      ['q3', 'false', 'true'],
    ]);
    expect(disputes[0].reason).toBe('Advice is safest.');
  });

  it('disputes a matching answer the check calls ambiguous', () => {
    const disputes = compareAnswerKey(
      quiz(),
      answers({ answers: [{ n: 1, answer: ['B'], ambiguous: true }] }),
    );
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({
      ambiguous: true,
      keyed: disputes[0].answered,
    });
  });

  it('ignores skipped questions, unknown letters, junk and unchecked types', () => {
    const solved = answers({
      answers: [
        { n: 1, answer: ['Z'] },
        { n: 3, answer: ['maybe'] },
        { n: 4, answer: ['A'] },
        { n: 0, answer: ['A'] },
        'junk',
      ],
    });
    expect(compareAnswerKey(quiz(), solved)).toEqual([]);
  });
});

describe('answerKeyProblems', () => {
  it('tells the writer what the check answered and how to fix it', () => {
    const [text] = answerKeyProblems([
      {
        questionId: 'q1',
        number: 1,
        prompt: 'First move?',
        keyed: 'B "Reflect"',
        answered: 'A "Advice"',
        ambiguous: false,
        reason: 'Advice is safest.',
      },
    ]);
    expect(text).toBe(
      'Question 1 ("First move?"): an independent check that could not see the answer key ' +
        'answered A "Advice" where the key marks B "Reflect". Its reason: Advice is safest. ' +
        'Fix the key, or rewrite the question so that only the keyed answer is right.',
    );
  });
});

describe('AnswerKeyCheckSpecialist', () => {
  it('is off unless COURSE_PILOT_ANSWER_CHECK is on', () => {
    const llm = fakeLlm([]);
    expect(new AnswerKeyCheckSpecialist(llm.service).enabled).toBe(false);
    expect(
      new AnswerKeyCheckSpecialist(llm.service, {
        courseCopilot: { answerCheck: true },
      } as any).enabled,
    ).toBe(true);
  });

  it('asks without the key and returns the disputes', async () => {
    const llm = fakeLlm(
      [{ answers: [{ n: 1, answer: ['A'] }] }],
      'Q={{questions_json}}',
    );
    const disputes = await new AnswerKeyCheckSpecialist(llm.service).check(
      quiz(),
      { title: 'Listening' } as any,
    );
    expect(disputes.map((d) => d.questionId)).toEqual(['q1']);
    expect(llm.promptOf(0)).toContain('"Reflect what you heard"');
    expect(llm.promptOf(0)).not.toContain('correctOptionIds');
  });

  it('never throws when the check fails', async () => {
    const check = new AnswerKeyCheckSpecialist({
      runJson: jest.fn().mockRejectedValue(new Error('model down')),
    } as any);
    await expect(check.check(quiz(), {} as any)).resolves.toEqual([]);
  });
});

describe('QuizSpecialist with the answer-key check', () => {
  const WRITTEN = {
    questions: [
      {
        id: 'q1',
        type: 'mcq_single',
        prompt: 'First move?',
        options,
        correctOptionIds: ['o2'],
        explanation: 'Reflect first.',
      },
      {
        id: 'q2',
        type: 'true_false',
        prompt: 'Reassure early.',
        correctAnswer: false,
        explanation: 'It closes the conversation.',
      },
    ],
  };
  const dispute = (over: Partial<AnswerKeyDispute> = {}): AnswerKeyDispute => ({
    questionId: '',
    number: 1,
    prompt: 'First move?',
    keyed: 'B',
    answered: 'A',
    ambiguous: false,
    reason: '',
    ...over,
  });
  const checker = (result: (content: QuizContent) => AnswerKeyDispute[]) => ({
    enabled: true,
    check: jest.fn(async (content: QuizContent) => result(content)),
  });

  it('does not check when switched off', async () => {
    const llm = fakeLlm([WRITTEN]);
    const check = { enabled: false, check: jest.fn() };
    await new QuizSpecialist(llm.service, check as any).generate(
      makeContext('qz-1'),
    );
    expect(check.check).not.toHaveBeenCalled();
  });

  it('sends disputes back to the writer on the first pass', async () => {
    const llm = fakeLlm([WRITTEN]);
    const check = checker((content) => [
      dispute({ questionId: content.questions[0].id }),
    ]);
    const error = await new QuizSpecialist(llm.service, check as any)
      .generate(makeContext('qz-1'))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors[0]).toMatch(
      /^Question 1 \("First move\?"\): an independent check/,
    );
  });

  it('drops a still-disputed question on the repair pass while half the quiz remains', async () => {
    const llm = fakeLlm([WRITTEN]);
    const check = checker((content) => [
      dispute({ questionId: content.questions[1].id, number: 2 }),
    ]);
    const output = await new QuizSpecialist(llm.service, check as any).generate(
      makeContext('qz-1', { repairErrors: ['Question 2 disputed.'] }),
    );
    const questions = (output.content as any).questions;
    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toBe('First move?');
    expect(output.summary).toBe(
      '1 question (all multiple choice) · 1 question removed: answer key disputed',
    );
  });

  it('keeps a question the check only called ambiguous', async () => {
    const llm = fakeLlm([WRITTEN]);
    const check = checker((content) => [
      dispute({
        questionId: content.questions[0].id,
        keyed: 'B',
        answered: 'B',
        ambiguous: true,
      }),
    ]);
    const output = await new QuizSpecialist(llm.service, check as any).generate(
      makeContext('qz-1', { repairErrors: ['Question 1 ambiguous.'] }),
    );
    expect((output.content as any).questions).toHaveLength(2);
  });

  it('keeps the quiz and says so when dropping would remove more than half', async () => {
    const llm = fakeLlm([WRITTEN]);
    const check = checker((content) =>
      content.questions.map((q, i) =>
        dispute({ questionId: q.id, number: i + 1 }),
      ),
    );
    const output = await new QuizSpecialist(llm.service, check as any).generate(
      makeContext('qz-1', { repairErrors: ['disputed'] }),
    );
    expect((output.content as any).questions).toHaveLength(2);
    expect(output.summary).toMatch(
      /2 answers still disputed, check before publishing$/,
    );
  });
});
