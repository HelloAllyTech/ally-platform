import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {LineTextInput} from '../LineTextInput';

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LeftArrowIcon: (props: any) => <View testID="left-arrow-icon" />,
  };
});

describe('LineTextInput', () => {
  const defaultProps = {
    placeholder: 'Enter text...',
    value: '',
    onChangeText: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with placeholder', () => {
    const {getByPlaceholderText} = render(
      <LineTextInput {...defaultProps} />,
    );
    expect(getByPlaceholderText('Enter text...')).toBeTruthy();
  });

  it('displays the current value', () => {
    const {getByDisplayValue} = render(
      <LineTextInput {...defaultProps} value="Hello" />,
    );
    expect(getByDisplayValue('Hello')).toBeTruthy();
  });

  it('calls onChangeText when text changes', () => {
    const onChangeText = jest.fn();
    const {getByPlaceholderText} = render(
      <LineTextInput {...defaultProps} onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByPlaceholderText('Enter text...'), 'new text');
    expect(onChangeText).toHaveBeenCalledWith('new text');
  });

  it('is multiline by default', () => {
    const {getByPlaceholderText} = render(
      <LineTextInput {...defaultProps} />,
    );
    expect(getByPlaceholderText('Enter text...').props.multiline).toBe(true);
  });

  it('respects multiline=false', () => {
    const {getByPlaceholderText} = render(
      <LineTextInput {...defaultProps} multiline={false} />,
    );
    expect(getByPlaceholderText('Enter text...').props.multiline).toBe(false);
  });

  it('does not show send button by default', () => {
    const {queryByTestId} = render(<LineTextInput {...defaultProps} />);
    expect(queryByTestId('left-arrow-icon')).toBeNull();
  });

  it('shows send button when showSendButton is true', () => {
    const {getByTestId} = render(
      <LineTextInput {...defaultProps} showSendButton onSend={jest.fn()} />,
    );
    expect(getByTestId('left-arrow-icon')).toBeTruthy();
  });

  it('calls onSend when send button is pressed', () => {
    const onSend = jest.fn();
    const {getByTestId} = render(
      <LineTextInput {...defaultProps} showSendButton onSend={onSend} />,
    );
    fireEvent.press(getByTestId('left-arrow-icon'));
    expect(onSend).toHaveBeenCalled();
  });

  it('passes maxLength to TextInput', () => {
    const {getByPlaceholderText} = render(
      <LineTextInput {...defaultProps} maxLength={100} />,
    );
    expect(getByPlaceholderText('Enter text...').props.maxLength).toBe(100);
  });

  it('passes numberOfLines to TextInput', () => {
    const {getByPlaceholderText} = render(
      <LineTextInput {...defaultProps} numberOfLines={3} />,
    );
    expect(getByPlaceholderText('Enter text...').props.numberOfLines).toBe(3);
  });
});
