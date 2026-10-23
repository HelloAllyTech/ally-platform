import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {InteractionsBar} from '../InteractionsBar';

const mockAddReactionToReview = jest.fn().mockResolvedValue({});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/contexts/ReviewApiContext', () => ({
  useReviewApiHooks: () => ({
    useAddReactionToReview: () => [mockAddReactionToReview, {isLoading: false}],
    reviewType: 'simulation',
  }),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    CommentIcon: (props: any) =>
      React.createElement(View, {...props, testID: 'comment-icon'}),
  };
});

jest.mock('@/screens/ReviewScreen/components', () => ({
  ReactionsCount: ({reviewId, totalReactions}: any) => {
    const React = require('react');
    const {View, Text} = require('react-native');
    return React.createElement(
      View,
      {testID: 'reactions-count'},
      React.createElement(Text, null, `Reactions: ${totalReactions}`),
    );
  },
}));

jest.mock('../../CustomSwitch', () => {
  const React = require('react');
  const {TouchableOpacity, Text} = require('react-native');
  return {
    CustomSwitch: ({value, onToggle}: {value: boolean; onToggle: (v: boolean) => void}) =>
      React.createElement(
        TouchableOpacity,
        {
          testID: 'custom-switch',
          onPress: () => onToggle(!value),
        },
        React.createElement(Text, null, value ? 'On' : 'Off'),
      ),
  };
});

jest.mock('../../EmojiPicker', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EmojiPicker: ({
      onEmojiSelect,
      disabled,
    }: {
      onEmojiSelect?: (current: string | null, unicode: string) => void;
      disabled?: boolean;
    }) =>
      React.createElement(View, {
        testID: 'emoji-picker',
        onPress: () => !disabled && onEmojiSelect?.(null, '👍'),
      }),
  };
});

jest.mock('@/utils/reviews', () => ({
  getReactionAction: (current: string | null, unicode: string) =>
    current === unicode ? 'remove' : 'add',
}));

const defaultProps = {
  reviewId: 'review-1',
  reactions: {'\u{1F44D}': 2, '\u2764\uFE0F': 1} as Record<string, number>,
  commentsCount: 5,
};

describe('InteractionsBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders comment icon', () => {
    const {getByTestId} = render(<InteractionsBar {...defaultProps} />);
    expect(getByTestId('comment-icon')).toBeTruthy();
  });

  it('renders comments count badge when commentsCount > 0', () => {
    const {getByText} = render(<InteractionsBar {...defaultProps} />);
    expect(getByText('5')).toBeTruthy();
  });

  it('shows 99+ when commentsCount exceeds 99', () => {
    const {getByText} = render(
      <InteractionsBar {...defaultProps} commentsCount={100} />,
    );
    expect(getByText('99+')).toBeTruthy();
  });

  it('does not render badge when commentsCount is 0', () => {
    const {queryByText} = render(
      <InteractionsBar {...defaultProps} commentsCount={0} />,
    );
    expect(queryByText('0')).toBeNull();
  });

  it('calls onCommentPress when comment icon is pressed', () => {
    const onCommentPress = jest.fn();
    const {getByTestId} = render(
      <InteractionsBar {...defaultProps} onCommentPress={onCommentPress} />,
    );
    fireEvent.press(getByTestId('comment-icon'));
    expect(onCommentPress).toHaveBeenCalledTimes(1);
  });

  it('renders reactions count section', () => {
    const {getByTestId} = render(<InteractionsBar {...defaultProps} />);
    expect(getByTestId('reactions-count')).toBeTruthy();
  });

  it('renders share switch when onTogglePrivate is provided', () => {
    const {getByTestId} = render(
      <InteractionsBar
        {...defaultProps}
        onTogglePrivate={jest.fn()}
      />,
    );
    expect(getByTestId('custom-switch')).toBeTruthy();
  });

  it('does not render share switch when onTogglePrivate is not provided', () => {
    const {queryByTestId} = render(<InteractionsBar {...defaultProps} />);
    expect(queryByTestId('custom-switch')).toBeNull();
  });

  it('calls onTogglePrivate when switch is toggled', () => {
    const onTogglePrivate = jest.fn();
    const {getByTestId} = render(
      <InteractionsBar
        {...defaultProps}
        isPrivate
        onTogglePrivate={onTogglePrivate}
      />,
    );
    fireEvent.press(getByTestId('custom-switch'));
    // When isPrivate is true, switch shows value false; toggling passes the new value (true = share)
    expect(onTogglePrivate).toHaveBeenCalledWith(true);
  });

  it('renders with empty reactions', () => {
    const {getByTestId} = render(
      <InteractionsBar {...defaultProps} reactions={{}} />,
    );
    expect(getByTestId('reactions-count')).toBeTruthy();
  });
});
