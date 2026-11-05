import React from 'react';
import {Text, View} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
  ms: (v: number) => v,
}));

jest.mock('@/theme', () => ({
  fontFamily: {IBM_PLEX_SERIF: {REGULAR: {}}},
}));

import {MenuOption} from '../MenuOption';

describe('MenuOption', () => {
  const defaultProps = {
    icon: <View testID="test-icon" />,
    text: 'Settings',
    onPress: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders icon and text', () => {
    const {getByTestId, getByText} = render(
      <MenuOption {...defaultProps} />,
    );

    expect(getByTestId('test-icon')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const {getByText} = render(
      <MenuOption {...defaultProps} onPress={onPress} />,
    );

    fireEvent.press(getByText('Settings'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    const {getByText} = render(
      <MenuOption {...defaultProps} onPress={onPress} disabled={true} />,
    );

    fireEvent.press(getByText('Settings'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('applies custom textColor', () => {
    const {getByText} = render(
      <MenuOption {...defaultProps} textColor="#ff0000" />,
    );

    const textEl = getByText('Settings');
    const flatStyle = Array.isArray(textEl.props.style)
      ? Object.assign({}, ...textEl.props.style)
      : textEl.props.style;
    expect(flatStyle.color).toBe('#ff0000');
  });

  it('renders with custom text style', () => {
    const {getByText} = render(
      <MenuOption {...defaultProps} textStyle={{fontSize: 20}} />,
    );

    expect(getByText('Settings')).toBeTruthy();
  });
});
