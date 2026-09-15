import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {ArticleQuestion, TrackItemType} from '@/types';

import {ArticlePlayer} from '../ArticlePlayer';

jest.mock('@/hooks', () => ({
  useTranslate: jest.fn(() => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  })),
}));

jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    RichText: ({html}: any) => <RN.Text testID="rich-text">{html}</RN.Text>,
    Button: ({label, onPress, isDisabled, testID}: any) => (
      <RN.TouchableOpacity
        testID={testID}
        onPress={onPress}
        disabled={isDisabled}
        accessibilityState={{disabled: !!isDisabled}}>
        <RN.Text>{label}</RN.Text>
      </RN.TouchableOpacity>
    ),
  };
});

const mockMarkArticleRead = jest.fn(() => ({
  unwrap: jest.fn().mockResolvedValue({
    completed: true,
    unlockedItemIds: [],
    sectionCompleted: false,
    trackCompleted: false,
  }),
}));
const mockSubmitAnswer = jest.fn();

jest.mock('@/services', () => ({
  useMarkArticleReadMutation: jest.fn(() => [
    mockMarkArticleRead,
    {isLoading: false},
  ]),
  useSubmitArticleQuestionAnswerMutation: jest.fn(() => [
    mockSubmitAnswer,
    {isLoading: false},
  ]),
}));

const question = (
  id: string,
  overrides: Partial<ArticleQuestion> = {},
): ArticleQuestion => ({
  id,
  type: 'mcq_single',
  prompt: `Prompt ${id}`,
  points: 1,
  options: [
    {id: `${id}-a`, text: `Option A (${id})`},
    {id: `${id}-b`, text: `Option B (${id})`},
  ],
  answered: null,
  correctOptionId: null,
  explanation: null,
  ...overrides,
});

const payload = (questions: ArticleQuestion[]) => ({
  type: TrackItemType.ARTICLE as const,
  trackItemProgressId: 'progress-1',
  html: `<p>Body</p>${questions
    .map(q => `<div data-ally-question="${q.id}"></div>`)
    .join('')}`,
  minReadSeconds: 0,
  questions,
  answeredQuestionCount: questions.filter(q => q.answered).length,
});

const answerResult = (over: Record<string, unknown> = {}) => ({
  unwrap: jest.fn().mockResolvedValue({
    correct: false,
    selectedOptionId: 'q1-b',
    correctOptionId: 'q1-a',
    explanation: null,
    answeredQuestionCount: 1,
    totalQuestionCount: 1,
    completion: null,
    ...over,
  }),
});

const renderPlayer = (questions: ArticleQuestion[], onCompleted = jest.fn()) => {
  const utils = render(
    <ArticlePlayer
      payload={payload(questions)}
      itemId="item-1"
      alreadyCompleted={false}
      onCompleted={onCompleted}
    />,
  );
  return {...utils, onCompleted};
};

describe('ArticlePlayer — inline questions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders each question where its placeholder sat', () => {
    const {getByTestId} = renderPlayer([question('q1'), question('q2')]);
    expect(getByTestId('article-question-q1')).toBeTruthy();
    expect(getByTestId('article-question-q2')).toBeTruthy();
  });

  it('does not submit on selection alone — the answer is final, so it takes a confirm', () => {
    const {getByTestId} = renderPlayer([question('q1')]);
    fireEvent.press(getByTestId('article-question-option-q1-a'));
    expect(mockSubmitAnswer).not.toHaveBeenCalled();
  });

  it('keeps the check button disabled until an option is picked', () => {
    const {getByTestId} = renderPlayer([question('q1')]);
    const submit = getByTestId('article-question-submit-q1');
    expect(submit.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId('article-question-option-q1-a'));
    expect(
      getByTestId('article-question-submit-q1').props.accessibilityState
        .disabled,
    ).toBe(false);
  });

  it('sends the chosen option to the server', async () => {
    mockSubmitAnswer.mockReturnValue(answerResult());
    const {getByTestId} = renderPlayer([question('q1')]);

    fireEvent.press(getByTestId('article-question-option-q1-b'));
    fireEvent.press(getByTestId('article-question-submit-q1'));

    await waitFor(() =>
      expect(mockSubmitAnswer).toHaveBeenCalledWith({
        itemId: 'item-1',
        questionId: 'q1',
        selectedOptionId: 'q1-b',
      }),
    );
  });

  it('locks the choices and names the verdict after a wrong answer', async () => {
    mockSubmitAnswer.mockReturnValue(answerResult());
    const {getByTestId, queryByTestId, getByText} = renderPlayer([
      question('q1'),
    ]);

    fireEvent.press(getByTestId('article-question-option-q1-b'));
    fireEvent.press(getByTestId('article-question-submit-q1'));

    await waitFor(() =>
      expect(
        getByText(/courses\.article\.question\.incorrect/),
      ).toBeTruthy(),
    );
    expect(queryByTestId('article-question-submit-q1')).toBeNull();
    expect(
      getByTestId('article-question-option-q1-a').props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it('reports completion up when the last answer finishes the article', async () => {
    const completion = {
      completed: true,
      unlockedItemIds: ['item-2'],
      sectionCompleted: false,
      trackCompleted: false,
    };
    mockSubmitAnswer.mockReturnValue(
      answerResult({correct: true, selectedOptionId: 'q1-a', completion}),
    );
    const {getByTestId, onCompleted} = renderPlayer([question('q1')]);

    fireEvent.press(getByTestId('article-question-option-q1-a'));
    fireEvent.press(getByTestId('article-question-submit-q1'));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(completion));
  });

  it('blocks mark-as-read while a question is unanswered, and says why', () => {
    const {getByTestId, getByText} = renderPlayer([question('q1')]);
    expect(
      getByText('courses.article.answerQuestionToContinue'),
    ).toBeTruthy();
    fireEvent.press(getByTestId('article-mark-read'));
    expect(mockMarkArticleRead).not.toHaveBeenCalled();
  });

  it('pluralises the blocked footer for several questions', () => {
    const {getByText} = renderPlayer([question('q1'), question('q2')]);
    expect(
      getByText('courses.article.answerQuestionsToContinue'),
    ).toBeTruthy();
  });

  it('redraws a question answered in an earlier visit, with no way to change it', () => {
    const {getByText, queryByTestId} = renderPlayer([
      question('q1', {
        answered: {
          selectedOptionId: 'q1-b',
          correct: false,
          answeredAt: '2026-09-15T10:00:00Z',
        },
        correctOptionId: 'q1-a',
      }),
    ]);

    expect(getByText(/courses\.article\.question\.incorrect/)).toBeTruthy();
    expect(queryByTestId('article-question-submit-q1')).toBeNull();
    // Nothing outstanding, so the footer is back to the ordinary read flow.
    expect(
      queryByTestId('article-mark-read')?.props.accessibilityState.disabled,
    ).not.toBe(undefined);
  });

  it("shows the author's explanation when one came back", async () => {
    mockSubmitAnswer.mockReturnValue(
      answerResult({explanation: 'B is a common mix-up because…'}),
    );
    const {getByTestId, getByText} = renderPlayer([question('q1')]);

    fireEvent.press(getByTestId('article-question-option-q1-b'));
    fireEvent.press(getByTestId('article-question-submit-q1'));

    await waitFor(() =>
      expect(getByText('B is a common mix-up because…')).toBeTruthy(),
    );
  });

  /**
   * A translated body can come back without a placeholder. The server already
   * stops counting that question; the footer has to agree, or the reader is
   * held behind a question that is nowhere on screen.
   */
  it('does not hold the footer shut for a question that never renders', () => {
    const {getByTestId, queryByTestId, getByText} = render(
      <ArticlePlayer
        payload={{
          type: TrackItemType.ARTICLE as const,
          trackItemProgressId: 'progress-1',
          html: '<p>Body</p><div data-ally-question="q1"></div>',
          minReadSeconds: 0,
          questions: [question('q1'), question('q2')],
          answeredQuestionCount: 0,
        }}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={jest.fn()}
      />,
    );

    expect(getByTestId('article-question-q1')).toBeTruthy();
    expect(queryByTestId('article-question-q2')).toBeNull();
    // One outstanding question, not two.
    expect(getByText('courses.article.answerQuestionToContinue')).toBeTruthy();
  });
});
