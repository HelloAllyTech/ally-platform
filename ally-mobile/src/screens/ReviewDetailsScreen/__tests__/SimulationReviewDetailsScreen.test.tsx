import React from 'react';
import {render} from '@testing-library/react-native';

import {SimulationReviewDetailsScreen} from '../SimulationReviewDetailsScreen';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: jest.fn(), goBack: jest.fn()}),
  useUser: () => ({userData: {id: 1, name: 'Test User'}}),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: () => ['edit_simulation_review', 'view_simulation_review_threads', 'edit_simulation_review_thread'],
}));

jest.mock('@/constants', () => ({
  SCREEN_NAMES: {SHARE_SIMULATION: 'ShareSimulation'},
  USER_PERMISSIONS: {
    EDIT_SIMULATION_REVIEW: 'edit_simulation_review',
    VIEW_SIMULATION_REVIEW_THREADS: 'view_simulation_review_threads',
    EDIT_SIMULATION_REVIEW_THREAD: 'edit_simulation_review_thread',
  },
}));

jest.mock('@/services/reviewsApi', () => ({
  useLazyGetMessagesQuery: () => [
    jest.fn().mockResolvedValue({data: []}),
    {isLoading: false, isFetching: false, data: []},
  ],
  useGetReviewByIdQuery: () => ({
    data: {
      reviewStatus: 'visible',
      reactions: {},
      commentsCount: 0,
      myReaction: null,
      createdBy: {id: 1, name: 'Test'},
      generalCommentsThreadId: 'thread-1',
      scenario: {title: 'Scenario', coverImageUrl: '', coverVideoUrl: undefined},
      scenarioSession: {createdAt: '', duration: 60},
      note: null,
      createdAt: '2024-01-01',
    },
    refetch: jest.fn(),
  }),
  useAddReviewCommentMutation: () => [jest.fn(), {isLoading: false}],
  useMarkSimulationReviewAsReadMutation: () => [jest.fn()],
}));

jest.mock('@/contexts/ReviewApiContext', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ReviewApiProvider: ({children}: {children: React.ReactNode}) =>
      React.createElement(View, {testID: 'review-api-provider'}, children),
    simulationApiHooks: {},
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

describe('SimulationReviewDetailsScreen', () => {
  const route = {params: {reviewId: 'r1'}} as any;

  it('renders without crashing', () => {
    const {getByTestId} = render(
      <SimulationReviewDetailsScreen route={route} navigation={{} as any} />,
    );
    expect(getByTestId('review-details-layout')).toBeTruthy();
  });

  it('wraps content in ReviewApiProvider', () => {
    const {getByTestId} = render(
      <SimulationReviewDetailsScreen route={route} navigation={{} as any} />,
    );
    expect(getByTestId('review-api-provider')).toBeTruthy();
  });
});
