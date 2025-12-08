import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {Checkbox} from '../Checkbox';

describe('Checkbox', () => {
  const mockOnPress = jest.fn();

  beforeEach(() => {
    mockOnPress.mockClear();
  });

  it('renders correctly', () => {
    const {getByTestId} = render(
      <Checkbox checked={false} onPress={mockOnPress} testID="checkbox" />,
    );
    expect(getByTestId('checkbox')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const {getByTestId} = render(
      <Checkbox checked={false} onPress={mockOnPress} testID="checkbox" />,
    );

    fireEvent.press(getByTestId('checkbox'));
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const {getByTestId} = render(
      <Checkbox
        checked={false}
        onPress={mockOnPress}
        disabled={true}
        testID="checkbox"
      />,
    );

    fireEvent.press(getByTestId('checkbox'));
    expect(mockOnPress).not.toHaveBeenCalled();
  });
});
