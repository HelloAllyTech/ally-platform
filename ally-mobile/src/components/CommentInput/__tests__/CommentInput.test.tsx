import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CommentInput} from '../CommentInput';

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const {View, TextInput} = require('react-native');
  return {
    BottomSheetTextInput: (props: any) =>
      React.createElement(TextInput, {...props, testID: 'comment-input'}),
    BottomSheetView: ({children, ...props}: any) =>
      React.createElement(View, props, children),
  };
});

jest.mock('@/assets/icons', () => ({
  LeftArrowIcon: 'LeftArrowIcon',
}));

jest.mock('@/components/BottomSheet', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    BottomSheet: ({visible, children, onClose}: any) =>
      visible
        ? React.createElement(
            View,
            {testID: 'bottom-sheet'},
            children,
            React.createElement(Text, {
              testID: 'close-sheet',
              onPress: onClose,
              children: 'Close',
            }),
          )
        : null,
  };
});

jest.useFakeTimers();

const defaultProps = {
  visible: false,
  onClose: jest.fn(),
  onChangeText: jest.fn(),
  onSend: jest.fn(),
  comment: '',
};

describe('CommentInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render bottom sheet when visible is false', () => {
    const {queryByTestId} = render(<CommentInput {...defaultProps} />);
    expect(queryByTestId('bottom-sheet')).toBeNull();
  });

  it('renders bottom sheet when visible is true', () => {
    const {getByTestId} = render(
      <CommentInput {...defaultProps} visible />,
    );
    expect(getByTestId('bottom-sheet')).toBeTruthy();
  });

  it('renders input and send button when visible', () => {
    const {getByTestId} = render(
      <CommentInput {...defaultProps} visible />,
    );
    expect(getByTestId('comment-input')).toBeTruthy();
  });

  it('calls onChangeText when input changes', () => {
    const onChangeText = jest.fn();
    const {getByTestId} = render(
      <CommentInput
        {...defaultProps}
        visible
        onChangeText={onChangeText}
      />,
    );
    fireEvent.changeText(getByTestId('comment-input'), 'New comment');
    expect(onChangeText).toHaveBeenCalledWith('New comment');
  });

  it('calls onSend when send button is pressed and not disabled', () => {
    const onSend = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <CommentInput
        {...defaultProps}
        visible
        onSend={onSend}
        isSendButtonDisabled={false}
      />,
    );
    const {TouchableOpacity} = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.press(buttons[buttons.length - 1]);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not call onSend when isSendButtonDisabled is true', () => {
    const onSend = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <CommentInput
        {...defaultProps}
        visible
        onSend={onSend}
        isSendButtonDisabled
      />,
    );
    const {TouchableOpacity} = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(buttons[buttons.length - 1]);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows ActivityIndicator when isLoading is true', () => {
    const {UNSAFE_getByType} = render(
      <CommentInput {...defaultProps} visible isLoading />,
    );
    const {ActivityIndicator} = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('calls onClose when sheet close is triggered', () => {
    const onClose = jest.fn();
    const {getByTestId} = render(
      <CommentInput {...defaultProps} visible onClose={onClose} />,
    );
    fireEvent.press(getByTestId('close-sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
