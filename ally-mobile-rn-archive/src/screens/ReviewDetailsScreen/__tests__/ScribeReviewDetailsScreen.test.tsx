import React from 'react';
import {render} from '@testing-library/react-native';

import {ScribeReviewDetailsScreen} from '../ScribeReviewDetailsScreen';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
  useUser: () => ({userData: {id: 1, name: 'Test User'}}),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: () => ['edit_scribe_review'],
}));
jest.mock('@/constants', () => ({
  SCREEN_NAMES: {SHARE_CALL_LOG: 'ShareCallLog'},
  USER_PERMISSIONS: {EDIT_SCRIBE_REVIEW: 'edit_scribe_review'},
}));

jest.mock('@/services/scribeReviewsApi', () => ({
  useLazyGetScribeMessagesQuery: () => [
    jest.fn().mockResolvedValue({data: []}),
    {isLoading: false, isFetching: false, data: []},
  ],
  useGetScribeReviewByIdQuery: () => ({
    data: {
      reviewStatus: 'visible',
      reactions: {},
      commentsCount: 0,
      myReaction: null,
      createdBy: {id: 1, name: 'Test'},
      generalCommentsThreadId: 'thread-1',
      summaryName: 'Session',
      note: null,
      createdAt: '2024-01-01',
      scribeSession: {id: 1, createdAt: '', duration: 60},
    },
    refetch: jest.fn(),
  }),
  useAddScribeReviewCommentMutation: () => [jest.fn(), {isLoading: false}],
  useUpdateScribeReviewStatusMutation: () => [jest.fn(), {isLoading: false}],
  useMarkScribeReviewAsReadMutation: () => [jest.fn()],
}));

jest.mock('@/contexts/ReviewApiContext', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    ReviewApiProvider: ({children}: {children: React.ReactNode}) =>
      React.createElement(
        RN.View,
        {testID: 'wrapped-in-review-api-provider'},
        children,
      ),
    scribeApiHooks: {},
    useReviewApiHooks: () => ({}),
  };
});

jest.mock('../components/ReviewDetailsLayout', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    ReviewDetailsLayout: ({reviewId}: {reviewId: string}) =>
      React.createElement(
        View,
        {testID: 'review-details-layout'},
        React.createElement(Text, null, `Layout: ${reviewId}`),
      ),
  };
});

jest.mock('../hooks/useReviewDetailsLogic', () => ({
  useReviewDetailsLogic: () => ({
    isLoading: false,
    conversationMessages: [],
    isFetching: false,
    offset: 0,
    hasMore: false,
    isPrivate: false,
    handleTogglePrivate: jest.fn(),
    comment: '',
    showCommentInput: false,
    isAddingComment: false,
    handleChangeComment: jest.fn(),
    resetCommentInput: jest.fn(),
    handleSendComment: jest.fn(),
    handleSelection: jest.fn(),
    loadMoreMessages: jest.fn(),
    refreshMessages: jest.fn(),
    isThreadsBottomSheetVisible: false,
    closeThreadsBottomSheet: jest.fn(),
    showThreadsBottomSheet: jest.fn(),
    onThreadPress: jest.fn(),
    isCommentThreadBottomSheetVisible: false,
    closeCommentThreadBottomSheet: jest.fn(),
    selectedThreadId: null,
    handleHideCommentThreadBottomSheet: jest.fn(),
    onReplyPress: jest.fn(),
    onReplyPressFromGeneralComments: jest.fn(),
    onReplyPressFromInlineGeneral: jest.fn(),
    handleThreadCommentChange: jest.fn(),
    isReplyBottomSheetVisible: false,
    closeReplyBottomSheet: jest.fn(),
    selectedComment: null,
    setSelectedComment: jest.fn(),
    hideReplyBottomSheet: jest.fn(),
    isMessageThreadsVisible: false,
    handleCloseMessageThreads: jest.fn(),
    selectedMessageForThreads: null,
    selectedMessageContent: null,
    selectedMessageThreads: [],
    handleMessageThreadPress: jest.fn(),
    handleThreadClick: jest.fn(),
  }),
}));

jest.mock('@/utils', () => ({
  formatDurationFromSeconds: (sec: number) => `${sec}s`,
  isMinutesPassed: () => false,
}));

describe('ScribeReviewDetailsScreen', () => {
  const route = {params: {reviewId: 'r1'}} as any;

  it('renders without crashing', () => {
    const {getByTestId} = render(
      <ScribeReviewDetailsScreen route={route} navigation={{} as any} />,
    );
    expect(getByTestId('review-details-layout')).toBeTruthy();
  });

  it('wraps content in ReviewApiProvider', () => {
    const {getByTestId} = render(
      <ScribeReviewDetailsScreen route={route} navigation={{} as any} />,
    );
    expect(getByTestId('wrapped-in-review-api-provider')).toBeTruthy();
  });
});
