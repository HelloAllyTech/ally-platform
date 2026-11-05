import React from 'react';
import {render} from '@testing-library/react-native';

import {GeneralCommentsSection} from '../GeneralCommentsSection';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockUseGetGeneralReviewComments = jest.fn().mockReturnValue({
  data: undefined,
  isLoading: false,
});
jest.mock('@/contexts/ReviewApiContext', () => ({
  useReviewApiHooks: () => ({
    useLazyGetGeneralReviewComments: () => [
      jest.fn().mockResolvedValue({data: {data: [], count: 0}}),
      {isLoading: false, isFetching: false},
    ],
    useGetGeneralReviewComments: mockUseGetGeneralReviewComments,
    useAddReviewComment: () => [jest.fn(), {isLoading: false}],
    useUpdateComment: () => [jest.fn(), {isLoading: false}],
    useDeleteComment: () => [jest.fn()],
    useUpdateCommentVisibility: () => [jest.fn()],
    useAddReactionToComment: () => [jest.fn()],
  }),
}));

const mockUseCommentActions = jest.fn();
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useUser: () => ({
    userData: {id: 1, name: 'Test User', profileImageUrl: ''},
  }),
  useCommentActions: (config: unknown) => mockUseCommentActions(config),
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LeftArrowIcon: () => React.createElement(View, {testID: 'left-arrow-icon'}),
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ReviewComment: () => React.createElement(View, {testID: 'review-comment'}),
    UserProfileImage: () =>
      React.createElement(View, {testID: 'user-profile-image'}),
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
  reviewId: 'review-1',
  generalCommentsThreadId: 'thread-1',
};

describe('GeneralCommentsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCommentActions.mockReturnValue({
      comments: null,
      setComments: jest.fn(),
      commentText: '',
      setCommentText: jest.fn(),
      editingCommentId: null,
      setEditingCommentId: jest.fn(),
      deleteCommentId: null,
      handleCancelDelete: jest.fn(),
      handleDeleteComment: jest.fn(),
      handleConfirmDelete: jest.fn(),
      handleHideComment: jest.fn(),
      handleEmojiSelect: jest.fn(),
      onSubmitComment: jest.fn(),
      isSubmitting: false,
      userId: 1,
    });
  });

  it('renders title text', () => {
    const {getByText} = render(
      <GeneralCommentsSection {...defaultProps} />,
    );
    expect(getByText('review.details.comments')).toBeTruthy();
  });

  it('shows loading indicator when loading with no comments', () => {
    mockUseGetGeneralReviewComments.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    mockUseCommentActions.mockReturnValue({
      comments: null,
      setComments: jest.fn(),
      commentText: '',
      setCommentText: jest.fn(),
      editingCommentId: null,
      setEditingCommentId: jest.fn(),
      deleteCommentId: null,
      handleCancelDelete: jest.fn(),
      handleDeleteComment: jest.fn(),
      handleConfirmDelete: jest.fn(),
      handleHideComment: jest.fn(),
      handleEmojiSelect: jest.fn(),
      onSubmitComment: jest.fn(),
      isSubmitting: false,
      userId: 1,
    });

    const {UNSAFE_getAllByType} = render(
      <GeneralCommentsSection {...defaultProps} />,
    );
    const {ActivityIndicator} = require('react-native');
    const indicators = UNSAFE_getAllByType(ActivityIndicator);
    expect(indicators.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty text when no comments and not loading', () => {
    mockUseGetGeneralReviewComments.mockReturnValue({
      data: {data: [], count: 0},
      isLoading: false,
    });
    mockUseCommentActions.mockReturnValue({
      comments: {data: [], count: 0},
      setComments: jest.fn(),
      commentText: '',
      setCommentText: jest.fn(),
      editingCommentId: null,
      setEditingCommentId: jest.fn(),
      deleteCommentId: null,
      handleCancelDelete: jest.fn(),
      handleDeleteComment: jest.fn(),
      handleConfirmDelete: jest.fn(),
      handleHideComment: jest.fn(),
      handleEmojiSelect: jest.fn(),
      onSubmitComment: jest.fn(),
      isSubmitting: false,
      userId: 1,
    });

    const {getByText} = render(
      <GeneralCommentsSection {...defaultProps} />,
    );
    expect(getByText('review.details.noCommentsYet')).toBeTruthy();
  });

  it('renders without crashing', () => {
    const {toJSON} = render(
      <GeneralCommentsSection {...defaultProps} />,
    );
    expect(toJSON()).toBeTruthy();
  });
});
