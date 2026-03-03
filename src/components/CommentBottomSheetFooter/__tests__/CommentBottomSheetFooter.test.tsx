import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CommentBottomSheetFooter} from '../CommentBottomSheetFooter';

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const {TextInput} = require('react-native');
  return {
    BottomSheetTextInput: (props: any) =>
      React.createElement(TextInput, {...props, testID: 'footer-input'}),
  };
});

jest.mock('@/assets/icons', () => ({
  LeftArrowIcon: 'LeftArrowIcon',
}));

const defaultProps = {
  text: '',
  setText: jest.fn(),
  onSubmit: jest.fn(),
  placeholder: 'Add a comment...',
  bottomInset: 0,
};

describe('CommentBottomSheetFooter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders input and send button', () => {
    const {getByTestId, toJSON} = render(
      <CommentBottomSheetFooter {...defaultProps} />,
    );
    expect(getByTestId('footer-input')).toBeTruthy();
    expect(toJSON()).not.toBeNull();
  });

  it('displays placeholder text', () => {
    const {getByPlaceholderText} = render(
      <CommentBottomSheetFooter {...defaultProps} />,
    );
    expect(getByPlaceholderText('Add a comment...')).toBeTruthy();
  });

  it('displays current text value', () => {
    const {getByDisplayValue} = render(
      <CommentBottomSheetFooter {...defaultProps} text="Hello" />,
    );
    expect(getByDisplayValue('Hello')).toBeTruthy();
  });

  it('calls setText when input changes', () => {
    const setText = jest.fn();
    const {getByTestId} = render(
      <CommentBottomSheetFooter {...defaultProps} setText={setText} />,
    );
    fireEvent.changeText(getByTestId('footer-input'), 'New text');
    expect(setText).toHaveBeenCalledWith('New text');
  });

  it('does not call onSubmit when text is empty and send is pressed', () => {
    const onSubmit = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <CommentBottomSheetFooter
        {...defaultProps}
        text=""
        onSubmit={onSubmit}
      />,
    );
    const {TouchableOpacity} = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    if (buttons.length > 0) {
      fireEvent.press(buttons[buttons.length - 1]);
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with text and clears when send is pressed with non-empty text', () => {
    const onSubmit = jest.fn();
    const setText = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <CommentBottomSheetFooter
        {...defaultProps}
        text="My comment"
        setText={setText}
        onSubmit={onSubmit}
      />,
    );
    const {TouchableOpacity} = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.press(buttons[buttons.length - 1]);
    expect(onSubmit).toHaveBeenCalledWith('My comment');
    expect(setText).toHaveBeenCalledWith('');
  });

  it('shows ActivityIndicator when isLoading is true', () => {
    const {UNSAFE_getByType} = render(
      <CommentBottomSheetFooter {...defaultProps} isLoading />,
    );
    const {ActivityIndicator} = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('does not call onSubmit when text is only whitespace', () => {
    const onSubmit = jest.fn();
    const setText = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <CommentBottomSheetFooter
        {...defaultProps}
        text="   "
        setText={setText}
        onSubmit={onSubmit}
      />,
    );
    const {TouchableOpacity} = require('react-native');
    const buttons = UNSAFE_getAllByType(TouchableOpacity);
    fireEvent.press(buttons[buttons.length - 1]);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
