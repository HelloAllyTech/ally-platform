import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {TrackItemType} from '@/types';

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
      <RN.TouchableOpacity testID={testID} onPress={onPress} disabled={isDisabled}>
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

jest.mock('@/services', () => ({
  useMarkArticleReadMutation: jest.fn(() => [mockMarkArticleRead, {isLoading: false}]),
}));

const buildPayload = () => ({
  type: TrackItemType.ARTICLE as const,
  trackItemProgressId: 'progress-1',
  html: '<p>Article body</p>',
  minReadSeconds: 1,
});

describe('ArticlePlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the article html', () => {
    const {getByTestId} = render(
      <ArticlePlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={jest.fn()}
      />,
    );
    expect(getByTestId('rich-text').props.children).toContain('Article body');
  });

  it('disables Mark as read until the reader scrolls near the bottom', () => {
    const {getByTestId} = render(
      <ArticlePlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId('article-mark-read'));
    expect(mockMarkArticleRead).not.toHaveBeenCalled();
  });

  it('enables Mark as read once scrolled past the threshold, and calls onCompleted', async () => {
    const onCompleted = jest.fn();
    const {getByTestId} = render(
      <ArticlePlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted={false}
        onCompleted={onCompleted}
      />,
    );

    fireEvent(getByTestId('article-scroll'), 'scroll', {
      nativeEvent: {
        contentOffset: {y: 950},
        contentSize: {height: 1000},
        layoutMeasurement: {height: 0},
      },
    });

    fireEvent.press(getByTestId('article-mark-read'));

    await waitFor(() => expect(mockMarkArticleRead).toHaveBeenCalledWith({itemId: 'item-1'}));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({completed: true}),
    ));
  });

  it('shows the "read" chip when already completed, hiding the mark-read button', () => {
    const {queryByTestId, getByText} = render(
      <ArticlePlayer
        payload={buildPayload()}
        itemId="item-1"
        alreadyCompleted
        onCompleted={jest.fn()}
      />,
    );
    expect(queryByTestId('article-mark-read')).toBeNull();
    expect(getByText('courses.article.read')).toBeTruthy();
  });
});
