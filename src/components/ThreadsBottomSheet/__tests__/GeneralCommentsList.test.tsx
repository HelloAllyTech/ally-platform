import React from 'react';
import {render} from '@testing-library/react-native';

import {GeneralCommentsList} from '../GeneralCommentsList';

const mockGetGeneralReviewComments = jest.fn().mockResolvedValue({
  data: {data: [], count: 0},
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const RN = require('react-native');
  return {
    BottomSheetFlatList: RN.FlatList,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/contexts/ReviewApiContext', () => ({
  useReviewApiHooks: () => ({
    useLazyGetGeneralReviewComments: () => [
      mockGetGeneralReviewComments,
      {isLoading: false, isFetching: false},
    ],
    useAddReviewComment: () => [jest.fn(), {isLoading: false}],
    useUpdateComment: () => [jest.fn(), {isLoading: false}],
    useDeleteComment: () => [jest.fn()],
    useUpdateCommentVisibility: () => [jest.fn()],
    useAddReactionToComment: () => [jest.fn()],
  }),
}));

const mockUseCommentActions = jest.fn();
const mockUsePaginatedComments = jest.fn();

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useCommentActions: (config: unknown) => mockUseCommentActions(config),
  usePaginatedComments: (options: unknown) => mockUsePaginatedComments(options),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    ReviewComment: ({comment}: {comment: string}) =>
      React.createElement(View, {testID: 'review-comment'}, comment),
  };
});

jest.mock('@/utils/date', () => ({
  formatRelativeTime: (date: string) => `formatted-${date}`,
  isMinutesPassed: () => false,
}));

jest.mock('@/utils/reviews', () => ({
  getReactionsArray: () => [],
  getTotalReactionCount: () => 0,
}));

const defaultProps = {
  visible: true,
  isPrivate: false,
  reviewId: 'review-1',
  reviewOwnerId: 1,
  generalCommentsThreadId: 'thread-1',
  controlRef: {current: {} as any},
  onDeleteCommentIdChange: jest.fn(),
  onCommentTextChange: jest.fn(),
  onSubmittingChange: jest.fn(),
};

describe('GeneralCommentsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCommentActions.mockReturnValue({
      comments: null,
      setComments: jest.fn(),
      commentText: '',
      setCommentText: jest.fn(),
      deleteCommentId: null,
      handleCancelDelete: jest.fn(),
      handleEditComment: jest.fn(),
      handleDeleteComment: jest.fn(),
      handleConfirmDelete: jest.fn(),
      handleHideComment: jest.fn(),
      handleEmojiSelect: jest.fn(),
      onSubmitComment: jest.fn(),
      isSubmitting: false,
      userId: 1,
    });
    mockUsePaginatedComments.mockReturnValue({
      hasMore: false,
      hasLoadedOnce: false,
      appendData: jest.fn(),
      reset: jest.fn(),
      getNextOffset: jest.fn(),
      canLoadMore: jest.fn(() => false),
    });
  });

  it('renders without crashing', () => {
    const {toJSON} = render(<GeneralCommentsList {...defaultProps} />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows empty state text when no comments', () => {
    mockUsePaginatedComments.mockReturnValue({
      hasMore: false,
      hasLoadedOnce: true,
      appendData: jest.fn(),
      reset: jest.fn(),
      getNextOffset: jest.fn(),
      canLoadMore: jest.fn(() => false),
    });
    mockUseCommentActions.mockReturnValue({
      ...mockUseCommentActions(),
      comments: {data: [], count: 0},
      setComments: jest.fn(),
    });

    const {getByText} = render(<GeneralCommentsList {...defaultProps} />);
    expect(getByText('threadsBottomSheet.noGeneralComments')).toBeTruthy();
  });

  it('shows loading indicator when loading', () => {
    mockUsePaginatedComments.mockReturnValue({
      hasMore: false,
      hasLoadedOnce: false,
      appendData: jest.fn(),
      reset: jest.fn(),
      getNextOffset: jest.fn(),
      canLoadMore: jest.fn(() => false),
    });
    mockUseCommentActions.mockReturnValue({
      ...mockUseCommentActions(),
      comments: null,
      setComments: jest.fn(),
    });

    const {UNSAFE_getAllByType} = render(
      <GeneralCommentsList {...defaultProps} />,
    );
    const {ActivityIndicator} = require('react-native');
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
  });
});
