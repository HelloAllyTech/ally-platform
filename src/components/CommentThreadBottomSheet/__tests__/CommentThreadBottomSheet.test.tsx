import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CommentThreadBottomSheet} from '../CommentThreadBottomSheet';

const mockHideCommentThreadBottomSheet = jest.fn();
const mockOnClose = jest.fn();

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
    setDeleteCommentId: jest.fn(),
    handleEditComment: jest.fn(),
    handleDeleteComment: jest.fn(),
    handleConfirmDelete: jest.fn(),
    handleHideComment: jest.fn(),
    handleEmojiSelect: jest.fn(),
    onSubmitComment: jest.fn(),
    isSubmitting: false,
    userId: 1,
  }),
}));

const mockGetThreadComments = jest.fn().mockResolvedValue({
  data: {data: [], count: 0},
});

jest.mock('@/services/reviewsApi', () => ({
  useLazyGetThreadCommentsQuery: () => [
    mockGetThreadComments,
    {isLoading: false, isFetching: false},
  ],
  useAddReviewCommentMutation: () => [jest.fn(), {isLoading: false}],
  useUpdateCommentMutation: () => [jest.fn(), {isLoading: false}],
  useDeleteCommentMutation: () => [jest.fn()],
  useUpdateCommentVisibilityMutation: () => [jest.fn()],
}));

jest.mock('@/services', () => ({
  useAddReactionToCommentMutation: () => [jest.fn()],
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
            {testID: 'comment-thread-bottom-sheet'},
            children,
            React.createElement(TouchableOpacity, {
              testID: 'sheet-close',
              onPress: onClose,
            }),
          )
        : null,
    CommentBottomSheetFooter: () =>
      React.createElement(View, {testID: 'comment-bottom-sheet-footer'}),
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

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFlatList: ({data, ListEmptyComponent}: any) => {
    const React = require('react');
    const {View, Text} = require('react-native');
    const Empty = ListEmptyComponent;
    if (!data || data.length === 0) {
      return Empty ? React.createElement(Empty) : React.createElement(View);
    }
    return React.createElement(View, {testID: 'comment-list'});
  },
  BottomSheetFooter: ({children}: any) => children,
  BottomSheetFooterProps: {},
}));

jest.mock('@/assets/icons', () => ({
  LeftArrow: 'LeftArrow',
}));

const defaultProps = {
  visible: true,
  onClose: mockOnClose,
  reviewId: 'review-1',
  threadId: 'thread-1',
  hideCommentThreadBottomSheet: mockHideCommentThreadBottomSheet,
};

describe('CommentThreadBottomSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    const {queryByTestId} = render(
      <CommentThreadBottomSheet {...defaultProps} visible={false} />,
    );
    expect(queryByTestId('comment-thread-bottom-sheet')).toBeNull();
  });

  it('renders bottom sheet when visible is true', () => {
    const {getByTestId} = render(
      <CommentThreadBottomSheet {...defaultProps} />,
    );
    expect(getByTestId('comment-thread-bottom-sheet')).toBeTruthy();
  });

  it('renders header with title', () => {
    const {getByText} = render(
      <CommentThreadBottomSheet {...defaultProps} />,
    );
    expect(getByText('CommentThreadBottomSheet.title')).toBeTruthy();
  });

  it('calls hideCommentThreadBottomSheet when back button is pressed', () => {
    const {UNSAFE_getAllByType} = render(
      <CommentThreadBottomSheet {...defaultProps} />,
    );
    const {TouchableOpacity} = require('react-native');
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    const backButton = touchables[0];
    if (backButton) {
      fireEvent.press(backButton);
      expect(mockHideCommentThreadBottomSheet).toHaveBeenCalledTimes(1);
    }
  });

  it('shows loading state while fetching comments', () => {
    const {getByTestId, UNSAFE_getAllByType} = render(
      <CommentThreadBottomSheet {...defaultProps} />,
    );
    expect(getByTestId('comment-thread-bottom-sheet')).toBeTruthy();
    const {ActivityIndicator} = require('react-native');
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThan(0);
  });

  it('does not render confirmation modal when deleteCommentId is null', () => {
    const {queryByTestId} = render(
      <CommentThreadBottomSheet {...defaultProps} />,
    );
    expect(queryByTestId('confirmation-modal')).toBeNull();
  });
});
