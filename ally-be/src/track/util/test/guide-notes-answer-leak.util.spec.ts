import { QuizQuestionType } from '../../type/quiz.type';
import { TrackItemType } from '../../type/track.type';
import {
  collectAnswerKeys,
  findAnswerLeaks,
} from '../guide-notes-answer-leak.util';

const items = [
  {
    id: 'quiz-1',
    title: 'Check your listening',
    type: TrackItemType.QUIZ,
    content: {
      settings: { passScore: 70 },
      questions: [
        {
          id: 'q1',
          type: QuizQuestionType.MCQ_SINGLE,
          prompt: 'What should a listener do first when a caller is crying?',
          options: [
            { id: 'a', text: 'Give them space and stay present' },
            { id: 'b', text: 'Ask for their full name' },
          ],
          correctOptionIds: ['a'],
        },
        {
          id: 'q2',
          type: QuizQuestionType.MCQ_SINGLE,
          prompt: 'Which skill mirrors the feeling behind a caller’s words?',
          options: [
            { id: 'a', text: 'Reflection' },
            { id: 'b', text: 'Advice' },
          ],
          correctOptionIds: ['a'],
        },
        {
          id: 'q3',
          type: QuizQuestionType.FILL_BLANK,
          prompt: 'Fill in the blank',
          template: 'Silence gives the caller {{b1}}.',
          blanks: [{ id: 'b1', acceptedAnswers: ['room to think'] }],
        },
        {
          id: 'q4',
          type: QuizQuestionType.TRUE_FALSE,
          prompt: 'Listeners should fix the problem.',
          correctAnswer: false,
        },
      ],
    },
  },
  {
    id: 'article-1',
    title: 'Opening a call',
    type: TrackItemType.ARTICLE,
    content: {
      html: '<p>…</p>',
      questions: [
        {
          id: 'aq1',
          type: QuizQuestionType.MCQ_SINGLE,
          prompt: 'How do you open a call?',
          options: [
            { id: 'x', text: 'With a warm, open question' },
            { id: 'y', text: 'With your script' },
          ],
          correctOptionIds: ['x'],
        },
      ],
    },
  },
  {
    id: 'video-1',
    title: 'A real call',
    type: TrackItemType.VIDEO,
    content: {
      source: 's3',
      url: 'https://example.com/v.mp4',
      interjections: [
        {
          id: 'i1',
          timestampSeconds: 30,
          question: {
            id: 'vq1',
            type: QuizQuestionType.MCQ_MULTI,
            prompt: 'What did the listener notice?',
            options: [
              { id: 'm', text: 'The caller’s breathing slowed down' },
              { id: 'n', text: 'Nothing' },
            ],
            correctOptionIds: ['m'],
          },
        },
      ],
    },
  },
];

describe('guide notes answer-leak check', () => {
  const keys = collectAnswerKeys(items);

  it('collects marked-correct answers from quizzes, article checks and video interjections', () => {
    expect(keys.map((key) => key.answer).sort()).toEqual(
      [
        'Give them space and stay present',
        'Reflection',
        'room to think',
        'With a warm, open question',
        'The caller’s breathing slowed down',
      ].sort(),
    );
  });

  it('blocks a long answer wherever it appears, ignoring case and punctuation', () => {
    const leaks = findAnswerLeaks(
      'Remind them: GIVE THEM SPACE, and stay present!',
      keys,
    );
    expect(leaks).toEqual([
      {
        itemId: 'quiz-1',
        itemTitle: 'Check your listening',
        questionId: 'q1',
        answer: 'Give them space and stay present',
      },
    ]);
  });

  it('blocks an accepted fill-in answer and an article or video answer', () => {
    const leaks = findAnswerLeaks(
      'Silence gives room to think. Open with a warm open question. ' +
        'Watch how the caller’s breathing slowed down.',
      keys,
    );
    expect(leaks.map((leak) => leak.questionId).sort()).toEqual([
      'aq1',
      'q3',
      'vq1',
    ]);
  });

  it('lets a short answer through as ordinary course vocabulary', () => {
    expect(
      findAnswerLeaks(
        'This course is about reflection. Encourage learners to practise reflection often.',
        keys,
      ),
    ).toEqual([]);
  });

  it('blocks a short answer in a sentence that restates its question', () => {
    const leaks = findAnswerLeaks(
      'If they ask which skill mirrors the feeling behind the words, it is reflection.',
      keys,
    );
    expect(leaks.map((leak) => leak.questionId)).toEqual(['q2']);
  });

  it('never treats a wrong option, or a true/false key, as an answer', () => {
    expect(
      findAnswerLeaks('Never ask for their full name. That is false.', keys),
    ).toEqual([]);
  });

  it('keeps Indic vowel signs when normalising', () => {
    const hindi = collectAnswerKeys([
      {
        id: 'q',
        title: 'प्रश्न',
        type: TrackItemType.QUIZ,
        content: {
          questions: [
            {
              id: 'h1',
              type: QuizQuestionType.MCQ_SINGLE,
              prompt: 'पहले क्या करें?',
              options: [{ id: 'a', text: 'ध्यान से सुनें और शांत रहें' }],
              correctOptionIds: ['a'],
            },
          ],
        },
      },
    ]);
    expect(
      findAnswerLeaks('हमेशा ध्यान से सुनें और शांत रहें।', hindi),
    ).toHaveLength(1);
    expect(findAnswerLeaks('ध्यान सुन शांत रह', hindi)).toEqual([]);
  });

  it('empty notes are always safe', () => {
    expect(findAnswerLeaks('', keys)).toEqual([]);
    expect(findAnswerLeaks(null, keys)).toEqual([]);
  });
});
