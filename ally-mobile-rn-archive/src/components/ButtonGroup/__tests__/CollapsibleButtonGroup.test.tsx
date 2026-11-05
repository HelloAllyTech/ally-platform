import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {CollapsibleButtonGroup} from '../CollapsibleButtonGroup';
import type {ButtonOption} from '../types';

describe('CollapsibleButtonGroup', () => {
  const mockOnPress = jest.fn();
  const mockOnToggle = jest.fn();

  const buttons: ButtonOption[] = [
    {
      id: 'button1',
      icon: <Text>Icon1</Text>,
      label: 'Button 1',
      onPress: mockOnPress,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders toggle button', () => {
    const {getByTestId} = render(
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={false}
        onToggleMaximized={mockOnToggle}
        testID="collapsible-group"
      />,
    );
    
    expect(getByTestId('collapsible-group-toggle')).toBeDefined();
  });

  it('does not show buttons when not maximized', () => {
    const {queryByText} = render(
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={false}
        onToggleMaximized={mockOnToggle}
      />,
    );
    
    expect(queryByText('Button 1')).toBeNull();
  });

  it('shows buttons when maximized', () => {
    const {getByText} = render(
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={true}
        onToggleMaximized={mockOnToggle}
      />,
    );
    
    expect(getByText('Button 1')).toBeDefined();
  });

  it('calls onToggleMaximized when toggle is pressed', () => {
    const {getByTestId} = render(
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={false}
        onToggleMaximized={mockOnToggle}
        testID="collapsible-group"
      />,
    );
    
    fireEvent.press(getByTestId('collapsible-group-toggle'));
    
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('handles button press when maximized', () => {
    const {getByText} = render(
      <CollapsibleButtonGroup
        buttons={buttons}
        isMaximized={true}
        onToggleMaximized={mockOnToggle}
      />,
    );
    
    fireEvent.press(getByText('Button 1'));
    
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });
});

