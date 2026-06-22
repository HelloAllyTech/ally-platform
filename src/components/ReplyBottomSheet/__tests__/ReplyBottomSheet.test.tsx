import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReplyBottomSheet} from '../ReplyBottomSheet';
import type {ReplyBottomSheetProps} from '../types';

const mockHideReplyBottomSheet = jest.fn();
const mockOnClose = jest.fn();
const mockSetOriginalComment = jest.fn();

const mockOriginalComment = {
  id: 'comment-1',
  content: 'Original comment text',
  createdAt: '2024-01-01T00:00:00Z',
  createdBy: {id: 1, name: 'User One', profileImage: null},
  reactions: {},
  replyCount: 2,
  hidden: false,
};

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFooter: 'BottomSheetFooter',
  BottomSheetFlatList: ({data, ListEmptyComponent}: any) => {
    const React = require('react');
    const {View} = require('react-native');
    const Empty = ListEmptyComponent;
    if (!data || data.length === 0) {
      return Empty ? React.createElement(Empty) : React.createElement(View);
    }
    return React.createElement(View, {testID: 'reply-list'});
  },
}));

jest.mock('@/contexts/ReviewApiContext', () => {
  const React = require('react');
  const mockGetCommentRepliesFn = jest
    .fn()
    .mockResolvedValue({data: {data: [], count: 0}});
  return {
    ReviewApiProvider: ({children}: {children: React.ReactNode}) => children,
    useReviewApiHooks: () => ({
      useLazyGetCommentReplies: () => [
        mockGetCommentRepliesFn,
        {isLoading: false, isFetching: false},
      ],
      useAddReviewComment: () => [jest.fn(), {isLoading: false}],
      useUpdateComment: () => [jest.fn(), {isLoading: false}],
      useDeleteComment: () => [jest.fn()],
      useUpdateCommentVisibility: () => [jest.fn()],
      useAddReactionToComment: () => [jest.fn()],
      useAddReactionToReview: () => [jest.fn()],
      useLazyGetReactions: () => [jest.fn(), {isLoading: false}],
      useLazyGetReactionsCount: () => [jest.fn(), {isLoading: false}],
      useLazyGetReviewComments: () => [jest.fn(), {isLoading: false}],
      useLazyGetThreads: () => [jest.fn(), {isLoading: false}],
      useLazyGetThreadComments: () => [jest.fn(), {isLoading: false}],
    }),
    simulationApiHooks: {},
    scribeApiHooks: {},
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useCommentActions: () => ({
    comments: null,
    setComments: jest.fn(),
    commentText: '',
    setCommentText: jest.fn(),
    editingCommentId: null,
    setEditingCommentId: jest.fn(),
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
  }),
  usePaginatedComments: () => ({
    hasMore: false,
    hasLoadedOnce: false,
    appendData: jest.fn(),
    reset: jest.fn(),
    getNextOffset: jest.fn(),
    canLoadMore: jest.fn(() => false),
  }),
  useStableFooterRenderer: () => jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    BottomSheet: ({visible, children, onClose}: any) =>
      visible
        ? React.createElement(
            View,
            {testID: 'reply-bottom-sheet'},
            children,
            React.createElement(TouchableOpacity, {
              testID: 'sheet-close',
              onPress: onClose,
            }),
          )
        : null,
    BottomSheetBackHeader: ({title, onBack}: any) =>
      React.createElement(
        View,
        {testID: 'bottom-sheet-back-header'},
        React.createElement(Text, null, title),
        React.createElement(TouchableOpacity, {
          testID: 'back-button',
          onPress: onBack,
        }),
      ),
    ConfirmationModal: ({visible}: any) =>
      visible ? React.createElement(View, {testID: 'confirmation-modal'}) : null,
    ReviewComment: () => React.createElement(View, {testID: 'review-comment'}),
  };
});

jest.mock('@/constants', () => ({
  EDIT_COMMENT_TIME_LIMIT_MINUTES: 15,
}));

jest.mock('@/utils/date', () => ({
  formatRelativeTime: (d: string) => `relative-${d}`,
  isMinutesPassed: () => false,
}));

jest.mock('@/utils/reviews', () => ({
  getReactionsArray: () => [],
  getTotalReactionCount: () => 0,
}));

const defaultProps: ReplyBottomSheetProps = {
  visible: true,
  onClose: mockOnClose,
  commentId: 'comment-1',
  originalComment: mockOriginalComment,
  setOriginalComment: mockSetOriginalComment,
  reviewId: 'review-1',
  hideReplyBottomSheet: mockHideReplyBottomSheet,
};

describe('ReplyBottomSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    const {queryByTestId} = render(
      <ReplyBottomSheet {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('reply-bottom-sheet')).toBeNull();
  });

  it('renders bottom sheet when visible is true', () => {
    const {getByTestId} = render(<ReplyBottomSheet {...defaultProps} />);
    expect(getByTestId('reply-bottom-sheet')).toBeTruthy();
  });

  it('renders header with title', () => {
    const {getByText} = render(<ReplyBottomSheet {...defaultProps} />);
    expect(getByText('replyBottomSheet.title')).toBeTruthy();
  });

  it('calls hideReplyBottomSheet when back button is pressed', () => {
    const {getByTestId} = render(<ReplyBottomSheet {...defaultProps} />);
    fireEvent.press(getByTestId('back-button'));
    expect(mockHideReplyBottomSheet).toHaveBeenCalledTimes(1);
  });

  it('does not render confirmation modal when deleteReplyId is null', () => {
    const {queryByTestId} = render(<ReplyBottomSheet {...defaultProps} />);
    expect(queryByTestId('confirmation-modal')).toBeNull();
  });

  it('renders original comment when provided', () => {
    const {getAllByTestId} = render(<ReplyBottomSheet {...defaultProps} />);
    const reviewComments = getAllByTestId('review-comment');
    expect(reviewComments.length).toBeGreaterThan(0);
  });

  it('renders without original comment when null', () => {
    const {getByTestId} = render(
      <ReplyBottomSheet
        {...defaultProps}
        originalComment={null}
        commentId=""
      />,
    );
    expect(getByTestId('reply-bottom-sheet')).toBeTruthy();
  });
});
