import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render} from '@testing-library/react-native';

import {ButtonItem} from '../ButtonItem';
import type {ButtonOption} from '../types';

describe('ButtonItem', () => {
  const mockOnPress = jest.fn();

  const defaultButton: ButtonOption = {
    id: 'test',
    icon: <Text>Icon</Text>,
    label: 'Test Button',
    onPress: mockOnPress,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default props', () => {
    const {getByText} = render(<ButtonItem button={defaultButton} />);
    
    expect(getByText('Icon')).toBeDefined();
    expect(getByText('Test Button')).toBeDefined();
  });

  it('calls onPress when pressed', () => {
    const {getByText} = render(<ButtonItem button={defaultButton} />);
    
    fireEvent.press(getByText('Test Button'));
    
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });

  it('renders disabled state correctly', () => {
    const disabledButton: ButtonOption = {
      ...defaultButton,
      disabled: true,
    };
    
    const {getByText} = render(<ButtonItem button={disabledButton} />);
    
    fireEvent.press(getByText('Test Button'));
    
    expect(mockOnPress).not.toHaveBeenCalled();
  });

  it('applies active variant style', () => {
    const activeButton: ButtonOption = {
      ...defaultButton,
      variant: 'active',
    };
    
    const {getByText} = render(<ButtonItem button={activeButton} />);
    
    expect(getByText('Test Button')).toBeDefined();
  });

  it('applies destructive variant style', () => {
    const destructiveButton: ButtonOption = {
      ...defaultButton,
      variant: 'destructive',
    };
    
    const {getByText} = render(<ButtonItem button={destructiveButton} />);
    
    expect(getByText('Test Button')).toBeDefined();
  });

  it('renders with testID', () => {
    const buttonWithTestID: ButtonOption = {
      ...defaultButton,
      testID: 'test-button',
    };
    
    const {getByTestId} = render(<ButtonItem button={buttonWithTestID} />);
    
    expect(getByTestId('test-button')).toBeDefined();
  });
});

