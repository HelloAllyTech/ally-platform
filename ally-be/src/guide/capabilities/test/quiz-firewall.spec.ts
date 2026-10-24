import { SessionItemStatus } from 'src/common/type/common.type';
import {
  QuizContent,
  QuizQuestionType,
  QuizShowExplanations,
} from 'src/track/type/quiz.type';
import { TrackItemType } from 'src/track/type/track.type';
import { buildCourseSpine } from '../../conductor/course-spine';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import { GuideAssessorService } from '../specialists/guide-assessor.service';
import {
  QuizAttemptView,
  decideQuizExplanation,
  findKeyMaterial,
  keyMaterial,
  learnerAllowedView,
  materialBefore,
} from '../quiz-firewall';

/**
 * The quiz firewall (plans/ally-guide/plan.md §6.4): `showExplanations` is
 * honoured exactly, `never` stays never across retakes, and nothing of the
 * key the learner has not been shown reaches the orchestrator.
 */

const CORRECT_HIDDEN = 'Name the feeling you hear before anything else';
const CORRECT_SHOWN = 'Wait and let the silence do some work';
const EXPLANATION = 'Silence gives the caller room to find their own words.';
const RUBRIC = 'Look for a reflection that names the emotion explicitly';
const ACCEPTED = 'open question about safety';

const quiz = (
  showExplanations: QuizShowExplanations,
  overrides: Partial<QuizContent['settings']> = {},
): QuizContent => ({
  settings: { passScore: 70, showExplanations, ...overrides },
  questions: [
    {
      id: 'q1',
      type: QuizQuestionType.MCQ_SINGLE,
      prompt: 'A caller goes quiet. What helps most?',
      explanation: EXPLANATION,
      options: [
        { id: 'a', text: CORRECT_SHOWN },
        { id: 'b', text: 'Fill the gap with reassurance quickly' },
      ],
      correctOptionIds: ['a'],
    },
    {
      id: 'q2',
      type: QuizQuestionType.MCQ_SINGLE,
      prompt: 'What comes first when a caller is upset?',
      showCorrectAnswer: false,
      options: [
        { id: 'a', text: CORRECT_HIDDEN },
        { id: 'b', text: 'Ask for their full history straight away' },
      ],
      correctOptionIds: ['a'],
    },
    {
      id: 'q3',
      type: QuizQuestionType.OPEN_ENDED,
      prompt: 'Write a reflection.',
      rubric: { guidance: RUBRIC, maxScore: 4 },
    },
    {
      id: 'q4',
      type: QuizQuestionType.FILL_BLANK,
      prompt: 'Ask an {{b1}}.',
      template: 'Ask an {{b1}}.',
      blanks: [{ id: 'b1', acceptedAnswers: [ACCEPTED] }],
    },
  ],
});

const attempt = (attemptNumber: number): QuizAttemptView => ({
  attemptNumber,
  answers: [
    { questionId: 'q1', selectedOptionIds: ['b'] },
    { questionId: 'q2', selectedOptionIds: ['b'] },
    { questionId: 'q3', text: 'You sound scared.' },
  ],
  grading: [
    { questionId: 'q1', correct: false, pointsAwarded: 0, pointsPossible: 1 },
    { questionId: 'q2', correct: false, pointsAwarded: 0, pointsPossible: 1 },
    {
      questionId: 'q3',
      correct: true,
      pointsAwarded: 1,
      pointsPossible: 1,
      llm: { score: 3, feedback: 'You named the feeling.' },
    },
  ],
});

describe('decideQuizExplanation', () => {
  it('keeps `never` as never, whatever the attempts', () => {
    for (const quizOpen of [false, true]) {
      for (const a of [null, attempt(1), attempt(2), attempt(5)]) {
        expect(
          decideQuizExplanation({
            showExplanations: QuizShowExplanations.NEVER,
            quizOpen,
            attempt: a,
          }),
        ).toEqual({ allowed: false, reason: 'never' });
      }
    }
  });

  it('reads an unknown setting as never', () => {
    expect(
      decideQuizExplanation({
        showExplanations: 'sometimes',
        quizOpen: false,
        attempt: attempt(1),
      }),
    ).toEqual({ allowed: false, reason: 'never' });
  });

  it('only points while the quiz is open, or before any attempt', () => {
    for (const setting of [
      QuizShowExplanations.AFTER_EACH,
      QuizShowExplanations.AFTER_SUBMIT,
    ]) {
      expect(
        decideQuizExplanation({
          showExplanations: setting,
          quizOpen: true,
          attempt: attempt(1),
        }),
      ).toEqual({ allowed: false, reason: 'quiz_open' });
      expect(
        decideQuizExplanation({
          showExplanations: setting,
          quizOpen: false,
          attempt: null,
        }),
      ).toEqual({ allowed: false, reason: 'no_attempt' });
      expect(
        decideQuizExplanation({
          showExplanations: setting,
          quizOpen: false,
          attempt: attempt(1),
        }),
      ).toEqual({ allowed: true });
    }
  });

  it('defaults a missing setting to after_submit, as the player does', () => {
    expect(
      decideQuizExplanation({
        showExplanations: undefined,
        quizOpen: false,
        attempt: attempt(1),
      }),
    ).toEqual({ allowed: true });
  });
});

describe('learnerAllowedView', () => {
  const view = learnerAllowedView(
    quiz(QuizShowExplanations.AFTER_SUBMIT),
    attempt(1),
  );
  const text = JSON.stringify(view);

  it('shows what the player shows: the explanation and a shown correct answer', () => {
    expect(view[0]).toMatchObject({
      number: 1,
      result: 'not_right',
      yourAnswer: 'Fill the gap with reassurance quickly',
      explanation: EXPLANATION,
      correctAnswer: CORRECT_SHOWN,
    });
  });

  it('never the answer to a question that hides it, a rubric, or an unsubmitted question', () => {
    expect(view[1].correctAnswer).toBeUndefined();
    expect(text).not.toContain(CORRECT_HIDDEN);
    expect(text).not.toContain(RUBRIC);
    expect(text).not.toContain(ACCEPTED);
    expect(view.map((q) => q.number)).toEqual([1, 2, 3]);
    expect(view[2].graderNote).toBe('You named the feeling.');
  });

  it('counts everything not shown as key material', () => {
    const material = keyMaterial(quiz(QuizShowExplanations.AFTER_SUBMIT), view);
    expect(
      findKeyMaterial(`Try: ${CORRECT_HIDDEN.toUpperCase()}!`, material),
    ).not.toBeNull();
    expect(findKeyMaterial(`The rubric: ${RUBRIC}`, material)).not.toBeNull();
    expect(findKeyMaterial(`Say "${ACCEPTED}"`, material)).not.toBeNull();
    // Shown already: not a leak.
    expect(findKeyMaterial(CORRECT_SHOWN, material)).toBeNull();
    expect(findKeyMaterial(EXPLANATION, material)).toBeNull();
  });
});

describe('materialBefore', () => {
  it('names the reached items before the quiz in its chapter', () => {
    const spine = buildCourseSpine({
      id: 'tr1',
      title: 'Course',
      enrolled: true,
      sections: [
        {
          id: 's1',
          title: 'One',
          order: 1,
          items: [
            {
              id: 'i1',
              type: TrackItemType.ARTICLE,
              order: 1,
              title: 'Silence',
              status: SessionItemStatus.COMPLETED,
            },
            {
              id: 'i2',
              type: TrackItemType.QUIZ,
              order: 2,
              title: 'Check',
              status: SessionItemStatus.UNLOCKED,
            },
          ],
        },
      ],
    } as never);
    expect(materialBefore(spine, 'i2')).toEqual(['Silence']);
  });
});

describe('GuideAssessorService.explainQuiz (the firewall end to end)', () => {
  const spine = buildCourseSpine({
    id: 'tr1',
    title: 'Course',
    enrolled: true,
    sections: [
      {
        id: 's1',
        title: 'One',
        order: 1,
        items: [
          {
            id: 'i1',
            type: TrackItemType.ARTICLE,
            order: 1,
            title: 'Silence',
            status: SessionItemStatus.COMPLETED,
          },
          {
            id: 'quiz',
            type: TrackItemType.QUIZ,
            order: 2,
            title: 'Check',
            status: SessionItemStatus.COMPLETED,
          },
        ],
      },
    ],
  } as never);

  function setup(
    content: QuizContent,
    attempts: QuizAttemptView[],
    reply = 'Question 1: silence gives the caller room.',
  ) {
    const requests: any[] = [];
    const models = {
      complete: jest.fn(async (call: any) => {
        requests.push(call.request);
        return {
          result: {
            stopReason: 'end_turn',
            content: [
              {
                type: 'text',
                text: JSON.stringify({ explanation: reply, questions: [1] }),
              },
            ],
          },
        };
      }),
    };
    const courseContent = {
      quizWithKey: jest.fn(async () => ({ title: 'Check', quiz: content })),
    };
    const latest = [...attempts].sort(
      (a, b) => b.attemptNumber - a.attemptNumber,
    )[0];
    const dataSource = {
      query: jest.fn(async () => (latest ? [latest] : [])),
    };
    const service = new GuideAssessorService(
      models as never,
      courseContent as never,
      dataSource as never,
    );
    const explain = (quizOpen = false) =>
      service.explainQuiz({
        trackId: 'tr1',
        quizItemId: 'quiz',
        userId: 3,
        spine,
        quizOpen,
        learnerQuestion: 'Why was question 2 wrong?',
        languageCode: 'en',
        bundle: GUIDE_DEFAULT_BUNDLE,
        attribution: {} as never,
      });
    return { explain, models, requests, dataSource };
  }

  it('`never`: points to the material on every retake, with no model call and no attempt read', async () => {
    const t = setup(quiz(QuizShowExplanations.NEVER), [
      attempt(1),
      attempt(2),
      attempt(3),
    ]);
    for (let i = 0; i < 3; i++) {
      const outcome = await t.explain();
      expect(outcome).toEqual({
        kind: 'point',
        quizTitle: 'Check',
        reason: 'never',
        material: ['Silence'],
      });
      const all = JSON.stringify(outcome);
      expect(all).not.toContain(EXPLANATION);
      expect(all).not.toContain(CORRECT_SHOWN);
    }
    expect(t.models.complete).not.toHaveBeenCalled();
    expect(t.dataSource.query).not.toHaveBeenCalled();
  });

  it('only points while the quiz is open', async () => {
    const t = setup(quiz(QuizShowExplanations.AFTER_EACH), [attempt(1)]);
    expect(await t.explain(true)).toMatchObject({
      kind: 'point',
      reason: 'quiz_open',
    });
    expect(t.models.complete).not.toHaveBeenCalled();
  });

  it('after_submit: the Assessor sees only what the player showed', async () => {
    const t = setup(quiz(QuizShowExplanations.AFTER_SUBMIT), [
      attempt(1),
      attempt(2),
    ]);
    const outcome = await t.explain();
    expect(outcome).toEqual({
      kind: 'explain',
      quizTitle: 'Check',
      attemptNumber: 2,
      explanation: 'Question 1: silence gives the caller room.',
      questions: [1],
    });
    const sent = JSON.stringify(t.requests[0].messages);
    expect(sent).toContain(EXPLANATION);
    expect(sent).toContain(CORRECT_SHOWN);
    expect(sent).not.toContain(CORRECT_HIDDEN);
    expect(sent).not.toContain(RUBRIC);
    expect(sent).not.toContain(ACCEPTED);
    expect(sent).not.toContain('correctOptionIds');
  });

  it('withholds a reply that reaches past what was shown', async () => {
    const t = setup(
      quiz(QuizShowExplanations.AFTER_SUBMIT),
      [attempt(1)],
      `The answer to 2 was: ${CORRECT_HIDDEN}.`,
    );
    const outcome = await t.explain();
    expect(outcome).toMatchObject({ kind: 'point', reason: 'withheld' });
    expect(JSON.stringify(outcome)).not.toContain(CORRECT_HIDDEN);
  });

  it('points when nothing has been submitted', async () => {
    const t = setup(quiz(QuizShowExplanations.AFTER_SUBMIT), []);
    expect(await t.explain()).toMatchObject({
      kind: 'point',
      reason: 'no_attempt',
    });
    expect(t.models.complete).not.toHaveBeenCalled();
  });
});
