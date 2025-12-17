import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {ButtonGroup} from '../ButtonGroup';
import type {ButtonOption} from '../types';

describe('ButtonGroup', () => {
  const mockOnPress1 = jest.fn();
  const mockOnPress2 = jest.fn();

  const buttons: ButtonOption[] = [
    {
      id: 'button1',
      icon: <Text>Icon1</Text>,
      label: 'Button 1',
      onPress: mockOnPress1,
    },
    {
      id: 'button2',
      icon: <Text>Icon2</Text>,
      label: 'Button 2',
      onPress: mockOnPress2,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all buttons', () => {
    const {getByText} = render(<ButtonGroup buttons={buttons} />);
    
    expect(getByText('Button 1')).toBeDefined();
    expect(getByText('Button 2')).toBeDefined();
  });

  it('handles button presses correctly', () => {
    const {getByText} = render(<ButtonGroup buttons={buttons} />);
    
    fireEvent.press(getByText('Button 1'));
    expect(mockOnPress1).toHaveBeenCalledTimes(1);
    expect(mockOnPress2).not.toHaveBeenCalled();
    
    fireEvent.press(getByText('Button 2'));
    expect(mockOnPress2).toHaveBeenCalledTimes(1);
  });

  it('renders with testID', () => {
    const {getByTestId} = render(
      <ButtonGroup buttons={buttons} testID="button-group" />,
    );
    
    expect(getByTestId('button-group')).toBeDefined();
  });

  it('renders empty list when no buttons provided', () => {
    const {queryByText} = render(<ButtonGroup buttons={[]} />);
    
    expect(queryByText('Button 1')).toBeNull();
  });
});

