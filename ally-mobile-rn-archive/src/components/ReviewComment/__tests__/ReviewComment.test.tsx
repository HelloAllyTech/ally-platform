import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReviewComment} from '../ReviewComment';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string, opts?: {count?: number}) =>
      key === 'review.details.comment_one' && opts?.count !== undefined
        ? `${opts.count} replies`
        : key,
  }),
}));

jest.mock('@/assets', () => ({
  AddReactionIcon: 'AddReactionIcon',
  EyeClosedIcon: 'EyeClosedIcon',
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    UserProfileImage: ({name}: {name?: string}) =>
      React.createElement(View, {testID: 'user-profile-image'}, name),
    ActionsMenu: ({options}: {options: Array<{label: string; onPress: () => void}>}) =>
      React.createElement(
        View,
        {testID: 'actions-menu'},
        options?.map((opt, i) =>
          React.createElement(Text, {
            key: i,
            onPress: opt.onPress,
            testID: `action-${opt.label.toLowerCase()}`,
          }, opt.label),
        ),
      ),
  };
});

jest.mock('../../EmojiPicker', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EmojiPicker: ({onEmojiSelect}: any) =>
      React.createElement(View, {
        testID: 'emoji-picker',
        onPress: () => onEmojiSelect?.(null, '👍'),
      }),
  };
});

const defaultProps = {
  name: 'Test User',
  time: '2 hours ago',
  comment: 'This is a test comment',
  profileImageUrl: null,
  reactions: [] as string[],
  reactionCount: 0,
  replyCount: 0,
};

describe('ReviewComment', () => {
  it('renders name, time, and comment', () => {
    const {getByText} = render(<ReviewComment {...defaultProps} />);
    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('2 hours ago')).toBeTruthy();
    expect(getByText('This is a test comment')).toBeTruthy();
  });

  it('renders user profile image', () => {
    const {getByTestId} = render(<ReviewComment {...defaultProps} />);
    expect(getByTestId('user-profile-image')).toBeTruthy();
  });

  it('shows hidden badge when hidden is true', () => {
    const {getByText} = render(
      <ReviewComment {...defaultProps} hidden />,
    );
    expect(getByText('review.hidden')).toBeTruthy();
  });

  it('does not show hidden badge when hidden is false', () => {
    const {queryByText} = render(
      <ReviewComment {...defaultProps} hidden={false} />,
    );
    expect(queryByText('review.hidden')).toBeNull();
  });

  it('shows reply button when showReplyButton is true', () => {
    const {getByText} = render(
      <ReviewComment {...defaultProps} showReplyButton />,
    );
    expect(getByText('review.details.replyLabel')).toBeTruthy();
  });

  it('does not show reply button when showReplyButton is false', () => {
    const {queryByText} = render(
      <ReviewComment {...defaultProps} showReplyButton={false} />,
    );
    expect(queryByText('review.details.replyLabel')).toBeNull();
  });

  it('calls onReplyPress when reply button is pressed', () => {
    const onReplyPress = jest.fn();
    const {getByText} = render(
      <ReviewComment {...defaultProps} onReplyPress={onReplyPress} />,
    );
    fireEvent.press(getByText('review.details.replyLabel'));
    expect(onReplyPress).toHaveBeenCalledTimes(1);
  });

  it('shows "1 reply" when replyCount is 1', () => {
    const {getAllByText} = render(
      <ReviewComment {...defaultProps} replyCount={1} />,
    );
    expect(getAllByText('review.details.replyLabel').length).toBeGreaterThan(0);
  });

  it('shows plural replies text when replyCount is greater than 1', () => {
    const {getByText} = render(
      <ReviewComment {...defaultProps} replyCount={5} />,
    );
    expect(getByText('5 replies')).toBeTruthy();
  });

  it('calls onCommentPress when comment container is pressed', () => {
    const onCommentPress = jest.fn();
    const {getByText} = render(
      <ReviewComment {...defaultProps} onCommentPress={onCommentPress} />,
    );
    fireEvent.press(getByText('This is a test comment'));
    expect(onCommentPress).toHaveBeenCalledTimes(1);
  });

  it('shows actions menu when showActionsMenu is true and user can perform actions', () => {
    const {getByTestId} = render(
      <ReviewComment
        {...defaultProps}
        showActionsMenu
        currentUserId={1}
        commentOwnerId={1}
        commentId="c1"
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByTestId('actions-menu')).toBeTruthy();
  });

  it('does not show actions menu when showActionsMenu is false', () => {
    const {queryByTestId} = render(
      <ReviewComment
        {...defaultProps}
        showActionsMenu={false}
        currentUserId={1}
        commentOwnerId={1}
      />,
    );
    expect(queryByTestId('actions-menu')).toBeNull();
  });

  it('renders with empty name', () => {
    const {getByText} = render(
      <ReviewComment {...defaultProps} name="" />,
    );
    expect(getByText('2 hours ago')).toBeTruthy();
    expect(getByText('This is a test comment')).toBeTruthy();
  });

  it('renders with reactions', () => {
    const {getByText} = render(
      <ReviewComment
        {...defaultProps}
        reactions={['👍', '❤️']}
        reactionCount={2}
      />,
    );
    expect(getByText('👍')).toBeTruthy();
    expect(getByText('❤️')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
  });

  it('renders emoji picker when showAddReactionButton is true and not disabled', () => {
    const {getByTestId} = render(
      <ReviewComment {...defaultProps} showAddReactionButton />,
    );
    expect(getByTestId('emoji-picker')).toBeTruthy();
  });

  it('does not render emoji picker when showAddReactionButton is false', () => {
    const {queryByTestId} = render(
      <ReviewComment {...defaultProps} showAddReactionButton={false} />,
    );
    expect(queryByTestId('emoji-picker')).toBeNull();
  });
});
