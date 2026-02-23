import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {EmojiPicker} from '../EmojiPicker';
import {EMOJI_UNICODE_MAP, PLATFORM_EMOJIS} from '../utils';

jest.mock('@/assets/icons', () => ({
  AddReactionIcon: 'AddReactionIcon',
}));

describe('EmojiPicker', () => {
  const onEmojiSelect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the trigger button', () => {
    const {getByTestId} = render(
      <EmojiPicker onEmojiSelect={onEmojiSelect} testID="emoji-picker" />,
    );
    expect(getByTestId('emoji-picker-button')).toBeTruthy();
  });

  it('does not show emoji list initially', () => {
    const {queryByTestId} = render(
      <EmojiPicker onEmojiSelect={onEmojiSelect} testID="emoji-picker" />,
    );
    expect(queryByTestId('emoji-picker-emoji-0')).toBeNull();
  });

  it('shows emoji list when trigger button is pressed', () => {
    const {getByTestId} = render(
      <EmojiPicker onEmojiSelect={onEmojiSelect} testID="emoji-picker" />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));
    expect(getByTestId('emoji-picker-emoji-0')).toBeTruthy();
  });

  it('renders all platform emojis when picker is open', () => {
    const {getByTestId} = render(
      <EmojiPicker onEmojiSelect={onEmojiSelect} testID="emoji-picker" />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));

    PLATFORM_EMOJIS.forEach((_emoji, idx) => {
      expect(getByTestId(`emoji-picker-emoji-${idx}`)).toBeTruthy();
    });
  });

  it('calls onEmojiSelect when an emoji is pressed', () => {
    const {getByTestId} = render(
      <EmojiPicker onEmojiSelect={onEmojiSelect} testID="emoji-picker" />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));
    fireEvent.press(getByTestId('emoji-picker-emoji-0'));

    expect(onEmojiSelect).toHaveBeenCalledWith(null, PLATFORM_EMOJIS[0]);
  });

  it('closes picker after selecting an emoji', () => {
    const {getByTestId, queryByTestId} = render(
      <EmojiPicker onEmojiSelect={onEmojiSelect} testID="emoji-picker" />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));
    fireEvent.press(getByTestId('emoji-picker-emoji-0'));

    expect(queryByTestId('emoji-picker-emoji-0')).toBeNull();
  });

  it('displays the selected emoji character instead of icon', () => {
    const selectedEmoji = PLATFORM_EMOJIS[0];
    const {getByText} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        selectedEmoji={selectedEmoji}
        testID="emoji-picker"
      />,
    );
    expect(getByText(EMOJI_UNICODE_MAP[selectedEmoji])).toBeTruthy();
  });

  it('deselects emoji when same emoji is pressed again', () => {
    const selectedEmoji = PLATFORM_EMOJIS[0];
    const {getByTestId} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        selectedEmoji={selectedEmoji}
        testID="emoji-picker"
      />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));
    fireEvent.press(getByTestId('emoji-picker-emoji-0'));

    expect(onEmojiSelect).toHaveBeenCalledWith(selectedEmoji, selectedEmoji);
  });

  it('disables the trigger button when disabled is true', () => {
    const {getByTestId} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        testID="emoji-picker"
        disabled
      />,
    );
    const button = getByTestId('emoji-picker-button');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('does not open picker when disabled', () => {
    const {getByTestId, queryByTestId} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        testID="emoji-picker"
        disabled
      />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));
    expect(queryByTestId('emoji-picker-emoji-0')).toBeNull();
  });

  it('closes picker when disabled prop changes to true while open', () => {
    const {getByTestId, queryByTestId, rerender} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        testID="emoji-picker"
        disabled={false}
      />,
    );
    fireEvent.press(getByTestId('emoji-picker-button'));
    expect(getByTestId('emoji-picker-emoji-0')).toBeTruthy();

    rerender(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        testID="emoji-picker"
        disabled
      />,
    );
    expect(queryByTestId('emoji-picker-emoji-0')).toBeNull();
  });

  it('renders with custom icon', () => {
    const {Text} = require('react-native');
    const CustomIcon = <Text testID="custom-icon">+</Text>;
    const {getByTestId} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        testID="emoji-picker"
        icon={CustomIcon}
      />,
    );
    expect(getByTestId('custom-icon')).toBeTruthy();
  });

  it('updates currentEmoji when selectedEmoji prop changes', () => {
    const {rerender, getByText} = render(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        selectedEmoji={PLATFORM_EMOJIS[0]}
        testID="emoji-picker"
      />,
    );
    expect(getByText(EMOJI_UNICODE_MAP[PLATFORM_EMOJIS[0]])).toBeTruthy();

    rerender(
      <EmojiPicker
        onEmojiSelect={onEmojiSelect}
        selectedEmoji={PLATFORM_EMOJIS[1]}
        testID="emoji-picker"
      />,
    );
    expect(getByText(EMOJI_UNICODE_MAP[PLATFORM_EMOJIS[1]])).toBeTruthy();
  });
});
