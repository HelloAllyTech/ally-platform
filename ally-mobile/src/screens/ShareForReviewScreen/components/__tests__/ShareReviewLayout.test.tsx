import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ShareReviewLayout} from '../ShareReviewLayout';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('rn-emoji-keyboard', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: ({open, onClose, onEmojiSelected}: any) =>
      open ? (
        <View testID="emoji-keyboard">
          <View testID="emoji-close" onTouchEnd={onClose} />
        </View>
      ) : null,
  };
});

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    AddReactionIcon: () => <View testID="add-reaction-icon" />,
    CloseIcon: () => <View testID="close-icon" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {TextInput, TouchableOpacity, Text, View} = require('react-native');
  return {
    Button: ({label, onPress}: any) => (
      <TouchableOpacity testID="submit-button" onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    LineTextInput: ({
      value,
      onChangeText,
      placeholder,
      maxLength,
    }: any) => (
      <TextInput
        testID="note-input"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    ),
  };
});

const defaultProps = {
  screenTitle: 'Share for Review',
  note: '',
  onChangeNote: jest.fn(),
  buttonLabel: 'Share',
  onSubmit: jest.fn(),
  onClose: jest.fn(),
  isEmojiPickerOpen: false,
  setIsEmojiPickerOpen: jest.fn(),
  onEmojiSelected: jest.fn(),
};

describe('ShareReviewLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders screen title', () => {
    const {getByText} = render(<ShareReviewLayout {...defaultProps} />);
    expect(getByText('Share for Review')).toBeTruthy();
  });

  it('renders note input with correct value', () => {
    const {getByTestId} = render(
      <ShareReviewLayout {...defaultProps} note="my note" />,
    );
    expect(getByTestId('note-input').props.value).toBe('my note');
  });

  it('renders button with correct label', () => {
    const {getByText} = render(<ShareReviewLayout {...defaultProps} />);
    expect(getByText('Share')).toBeTruthy();
  });

  it('calls onSubmit when button is pressed', () => {
    const {getByTestId} = render(<ShareReviewLayout {...defaultProps} />);
    fireEvent.press(getByTestId('submit-button'));
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });

  it('calls onClose when close icon is pressed', () => {
    const {getByTestId} = render(<ShareReviewLayout {...defaultProps} />);
    fireEvent.press(getByTestId('close-icon'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows note length counter when showNoteLength is true', () => {
    const {getByText} = render(
      <ShareReviewLayout
        {...defaultProps}
        note="hello"
        showNoteLength
        maxNoteLength={250}
      />,
    );
    expect(getByText('5/250')).toBeTruthy();
  });

  it('does not show note length when showNoteLength is false', () => {
    const {queryByText} = render(
      <ShareReviewLayout {...defaultProps} maxNoteLength={250} />,
    );
    expect(queryByText('0/250')).toBeNull();
  });

  it('renders children', () => {
    const React = require('react');
    const {Text} = require('react-native');

    const {getByText} = render(
      <ShareReviewLayout {...defaultProps}>
        <Text>Child content</Text>
      </ShareReviewLayout>,
    );
    expect(getByText('Child content')).toBeTruthy();
  });

  it('opens emoji picker when add reaction icon is pressed', () => {
    const {getByTestId} = render(<ShareReviewLayout {...defaultProps} />);
    fireEvent.press(getByTestId('add-reaction-icon'));
    expect(defaultProps.setIsEmojiPickerOpen).toHaveBeenCalledWith(true);
  });

  it('renders emoji keyboard when isEmojiPickerOpen is true', () => {
    const {getByTestId} = render(
      <ShareReviewLayout {...defaultProps} isEmojiPickerOpen />,
    );
    expect(getByTestId('emoji-keyboard')).toBeTruthy();
  });

  it('counts emoji characters correctly for note length', () => {
    const {getByText} = render(
      <ShareReviewLayout
        {...defaultProps}
        note="Hello 😀"
        showNoteLength
        maxNoteLength={250}
      />,
    );
    expect(getByText('7/250')).toBeTruthy();
  });
});
