import { SessionItemStatus } from 'src/common/type/common.type';
import { buildCourseSpine } from 'src/guide/conductor/course-spine';
import { renderSituationReport } from 'src/guide/conductor/situation-report';
import { GuideMode } from 'src/guide/enum/guide.enum';
import {
  QuizContent,
  QuizQuestionType,
  QuizShowExplanations,
} from 'src/track/type/quiz.type';
import { TrackItemType } from 'src/track/type/track.type';
import { checkPersonaScoring } from '../deterministic-checks';
import { quizKeysFromContent } from '../quiz-keys';
import { readSituation } from '../situation';

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
          title: 'Listening',
          status: SessionItemStatus.UNLOCKED,
        },
      ],
    },
  ],
});

/**
 * The evaluator reads budgets and release windows back from the situation
 * report's text. Rendering a real report here pins that contract: a change
 * to the report's wording fails this, not a silent night of wrong checks.
 */
describe('readSituation against the real renderer', () => {
  const render = (over: Partial<Parameters<typeof renderSituationReport>[0]>) =>
    renderSituationReport({
      turn: 3,
      mode: GuideMode.NORMAL,
      atmosphere: 'bright',
      channel: 'voice',
      guidance: 'drive',
      budget: { maxWords: 25, maxSentences: 2 },
      steer: {
        level: 0,
        reason: 'release window',
        dockVisible: false,
        mayPresentNext: false,
      },
      spine,
      firstWin: { kind: 'none' } as never,
      releaseWindowOpen: true,
      overlay: 'none',
      events: [],
      quizOpen: true,
      ...over,
    });

  it('reads the budget, channel, steer, guidance, release window and quiz', () => {
    expect(readSituation(render({}))).toEqual({
      mode: 'NORMAL',
      channel: 'voice',
      budget: { maxWords: 25, maxSentences: 2 },
      steerLevel: 0,
      guidance: 'drive',
      releaseWindowOpen: true,
      quizOpen: true,
      platformTurn: false,
    });
  });

  it('reads a text turn with neither window nor quiz', () => {
    const facts = readSituation(
      render({
        channel: 'text',
        guidance: 'walk',
        budget: { maxWords: 60, maxSentences: null },
        releaseWindowOpen: false,
        quizOpen: false,
      }),
    );
    expect(facts).toMatchObject({
      channel: 'text',
      budget: { maxWords: 60, maxSentences: null },
      guidance: 'walk',
      releaseWindowOpen: false,
      quizOpen: false,
    });
  });

  it('is empty, not wrong, for no report', () => {
    expect(readSituation(null)).toMatchObject({
      budget: null,
      releaseWindowOpen: false,
    });
  });
});

describe('quizKeysFromContent', () => {
  const quiz = (show: QuizShowExplanations): QuizContent => ({
    settings: { passScore: 70, showExplanations: show },
    questions: [
      {
        id: 'q1',
        type: QuizQuestionType.MCQ_SINGLE,
        prompt: 'First move?',
        options: [
          { id: 'a', text: 'Reflect the feeling' },
          { id: 'b', text: 'Give advice' },
        ],
        correctOptionIds: ['a'],
        explanation: 'Reflecting shows you heard them.',
      },
      {
        id: 'q2',
        type: QuizQuestionType.FILL_BLANK,
        prompt: 'Fill',
        template: 'Use {{b1}} questions',
        blanks: [{ id: 'b1', acceptedAnswers: ['open-ended'] }],
        showCorrectAnswer: false,
      },
      {
        id: 'q3',
        type: QuizQuestionType.TRUE_FALSE,
        prompt: 'Silence is bad',
        correctAnswer: false,
      },
    ],
  });

  it('keeps every key secret before submission', () => {
    expect(
      quizKeysFromContent(quiz(QuizShowExplanations.AFTER_SUBMIT)),
    ).toEqual([
      {
        answers: ['Reflect the feeling'],
        distractors: ['Give advice'],
        explanation: 'Reflecting shows you heard them.',
      },
      { answers: ['open-ended'], distractors: [], explanation: null },
    ]);
  });

  it('releases shown answers after submission, keeps hidden ones', () => {
    expect(
      quizKeysFromContent(quiz(QuizShowExplanations.AFTER_SUBMIT), {
        submitted: true,
      }).map((k) => k.answers),
    ).toEqual([['open-ended']]);
  });

  it('keeps everything secret when the quiz never shows explanations', () => {
    expect(
      quizKeysFromContent(quiz(QuizShowExplanations.NEVER), {
        submitted: true,
      }),
    ).toHaveLength(2);
  });
});

it('does not read a quiz tally as persona scoring', () => {
  expect(
    checkPersonaScoring({
      reply: {
        text: 'You got 8 out of 10 questions right on the quiz.',
        kind: 'model',
      },
      channel: 'text',
      learnerText: null,
      recent: [],
      mode: 'NORMAL',
      toolCalls: [],
      quizKeys: [],
      approvedCrisisTexts: [],
      praiseEveryTurns: 4,
    }).passed,
  ).toBe(true);
});
