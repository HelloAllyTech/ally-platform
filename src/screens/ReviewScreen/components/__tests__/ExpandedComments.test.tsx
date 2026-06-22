import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ExpandedComments} from '../ExpandedComments';
import type {GetThreadCommentsResponse} from '@/types/reviews';

jest.mock('@/assets', () => ({
  ChevronDown: 'ChevronDown',
}));

jest.mock('@/components', () => {
  const {Text} = require('react-native');
  return {
    ReviewComment: ({name, comment, time}: any) => (
      <Text testID="review-comment">{`${name}: ${comment} (${time})`}</Text>
    ),
  };
});

jest.mock('@/utils', () => ({
  formatRelativeTime: (date: string) => `relative-${date}`,
}));

jest.mock('@/utils/reviews', () => ({
  getReactionsArray: () => [],
  getTotalReactionCount: () => 0,
}));

const defaultProps = {
  isExpanded: true,
  isLoading: false,
  generalCommentsData: undefined,
  reviewId: 'review-1',
  onCollapsePress: jest.fn(),
  onCommentPress: jest.fn(),
  t: (key: string) => key,
};

describe('ExpandedComments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when not expanded', () => {
    const {toJSON} = render(
      <ExpandedComments {...defaultProps} isExpanded={false} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders loading indicator when isLoading is true', () => {
    const {UNSAFE_getByType} = render(
      <ExpandedComments {...defaultProps} isLoading />,
    );
    const {ActivityIndicator} = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('renders empty state when generalCommentsData has no comments', () => {
    const generalCommentsData: GetThreadCommentsResponse = {data: [], count: 0};
    const {getByText} = render(
      <ExpandedComments
        {...defaultProps}
        generalCommentsData={generalCommentsData}
      />,
    );
    expect(getByText('review.details.noCommentsYet')).toBeTruthy();
  });

  it('renders comments when generalCommentsData has comments', () => {
    const generalCommentsData: GetThreadCommentsResponse = {
      data: [
        {
          id: 'c1',
          content: 'Great work',
          createdAt: '2024-01-01T00:00:00Z',
          createdBy: {
            id: 1,
            name: 'Alice',
            profileImage: null,
          },
          reactions: {},
          replyCount: 0,
          hidden: false,
        },
      ],
      count: 1,
    };
    const {getByTestId, getByText} = render(
      <ExpandedComments
        {...defaultProps}
        generalCommentsData={generalCommentsData}
      />,
    );
    expect(getByTestId('review-comment')).toBeTruthy();
    expect(getByText(/Alice/)).toBeTruthy();
    expect(getByText(/Great work/)).toBeTruthy();
  });

  it('renders multiple comments', () => {
    const generalCommentsData: GetThreadCommentsResponse = {
      data: [
        {
          id: 'c1',
          content: 'First comment',
          createdAt: '2024-01-01T00:00:00Z',
          createdBy: {id: 1, name: 'Alice', profileImage: null},
          reactions: {},
          replyCount: 0,
          hidden: false,
        },
        {
          id: 'c2',
          content: 'Comment',
          createdAt: '2024-01-01T00:00:00Z',
          createdBy: {id: 2, name: 'Bob', profileImage: null},
          reactions: {},
          replyCount: 0,
          hidden: false,
        },
      ],
      count: 2,
    };
    const {getByText} = render(
      <ExpandedComments
        {...defaultProps}
        generalCommentsData={generalCommentsData}
      />,
    );
    expect(getByText(/Bob/)).toBeTruthy();
    expect(getByText(/Comment/)).toBeTruthy();
  });

  it('calls onCollapsePress when collapse button is pressed', () => {
    const onCollapsePress = jest.fn();
    const {getByText} = render(
      <ExpandedComments {...defaultProps} onCollapsePress={onCollapsePress} />,
    );
    fireEvent.press(getByText('calls.uploadProgress.collapse'));
    expect(onCollapsePress).toHaveBeenCalledTimes(1);
  });
});
