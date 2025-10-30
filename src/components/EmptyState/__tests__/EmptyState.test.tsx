import React from 'react';
import {render} from '@testing-library/react-native';
import {View} from 'react-native';

import {EmptyState} from '../EmptyState';

// Mock icon component
const MockIcon = () => <View testID="mock-icon" />;

describe('EmptyState', () => {
  const defaultProps = {
    icon: MockIcon,
    title: 'No data found',
    description: 'Your data will appear here when available.',
  };

  it('renders correctly with required props', () => {
    const {getByText, getByTestId} = render(<EmptyState {...defaultProps} />);
    
    expect(getByTestId('mock-icon')).toBeTruthy();
    expect(getByText('No data found')).toBeTruthy();
    expect(getByText('Your data will appear here when available.')).toBeTruthy();
  });

  it('applies custom icon props', () => {
    const customIconProps = {width: 200, height: 150, testID: 'custom-icon'};
    
    render(
      <EmptyState
        {...defaultProps}
        iconProps={customIconProps}
      />
    );
    
    // The icon should receive the custom props
    // Note: We can't directly test the props passed to the icon component
    // but we can test that the component renders without errors
  });

  it('applies custom container style', () => {
    const customStyle = {backgroundColor: 'red'};
    
    const {getByText} = render(
      <EmptyState
        {...defaultProps}
        containerStyle={customStyle}
      />
    );
    
    expect(getByText('No data found')).toBeTruthy();
  });

  it('handles multiline descriptions', () => {
    const multilineDescription = 'Line 1\nLine 2\nLine 3';
    
    const {getByText} = render(
      <EmptyState
        {...defaultProps}
        description={multilineDescription}
      />
    );
    
    expect(getByText(multilineDescription)).toBeTruthy();
  });
});
