import React from 'react';
import {Linking} from 'react-native';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {TrackItemType} from '@/types';

import {ArticlePlayer} from '../ArticlePlayer';

jest.mock('@/components/BottomSheet', () => {
  const RN = require('react-native');
  return {
    BottomSheet: ({visible, children}: any) =>
      visible ? <RN.View testID="bottom-sheet">{children}</RN.View> : null,
  };
});

jest.mock('react-native-webview', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => <RN.View testID={props.testID} />,
  };
});

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

const mockSubmitArticleQuestionAnswer = jest.fn();

jest.mock('@/services', () => ({
  useMarkArticleReadMutation: jest.fn(() => [mockMarkArticleRead, {isLoading: false}]),
  useSubmitArticleQuestionAnswerMutation: jest.fn(() => [
    mockSubmitArticleQuestionAnswer,
    {isLoading: false},
  ]),
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

  describe('resources', () => {
    const resource = {
      id: 'r1',
      title: 'Mental Health First Aid Guide',
      url: 'https://example.com/guide',
    };

    it('renders a resource row and opens the in-app sheet on press', () => {
      const {getByText, getByTestId} = render(
        <ArticlePlayer
          payload={{...buildPayload(), resources: [resource]}}
          itemId="item-1"
          alreadyCompleted={false}
          onCompleted={jest.fn()}
        />,
      );

      fireEvent.press(getByText(resource.title));

      expect(getByTestId('bottom-sheet')).toBeTruthy();
      expect(getByTestId('external-resource-webview')).toBeTruthy();
    });

    it('opens a document-extension link with the OS instead of the in-app sheet', () => {
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      const pdfResource = {...resource, url: 'https://example.com/guide.pdf'};
      const {getByText, queryByTestId} = render(
        <ArticlePlayer
          payload={{...buildPayload(), resources: [pdfResource]}}
          itemId="item-1"
          alreadyCompleted={false}
          onCompleted={jest.fn()}
        />,
      );

      fireEvent.press(getByText(pdfResource.title));

      expect(openUrlSpy).toHaveBeenCalledWith(pdfResource.url);
      expect(queryByTestId('bottom-sheet')).toBeNull();
      openUrlSpy.mockRestore();
    });

    it('does not require scrolling past the Resources section to mark the article read', () => {
      const {getByTestId} = render(
        <ArticlePlayer
          payload={{...buildPayload(), resources: [resource]}}
          itemId="item-1"
          alreadyCompleted={false}
          onCompleted={jest.fn()}
        />,
      );

      // Scroll position lands right at the end of the (short) article body,
      // well short of 95% of the total content (article + resources) height —
      // if Resources counted toward the completion threshold this would still
      // be disabled.
      fireEvent(getByTestId('article-scroll'), 'scroll', {
        nativeEvent: {
          contentOffset: {y: 40},
          contentSize: {height: 400},
          layoutMeasurement: {height: 40},
        },
      });
      fireEvent(getByTestId('article-end-sentinel'), 'layout', {
        nativeEvent: {layout: {y: 50, height: 1, x: 0, width: 0}},
      });
      fireEvent(getByTestId('article-scroll'), 'scroll', {
        nativeEvent: {
          contentOffset: {y: 40},
          contentSize: {height: 400},
          layoutMeasurement: {height: 40},
        },
      });

      expect(getByTestId('article-mark-read').props.accessibilityState?.disabled).not.toBe(
        true,
      );
    });
  });
});
