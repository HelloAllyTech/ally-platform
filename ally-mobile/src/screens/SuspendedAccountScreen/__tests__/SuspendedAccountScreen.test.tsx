import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SuspendedAccountScreen} from '../SuspendedAccountScreen';

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    EmptyState: () => React.createElement(Text, null, 'EmptyState'),
  };
});

const mockReset = jest.fn();
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({reset: mockReset}),
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('SuspendedAccountScreen', () => {
  it('resets navigation to Splash on button press', () => {
    const {getByText} = render(<SuspendedAccountScreen />);
    fireEvent.press(getByText('suspended.goToLogin'));
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'Splash'}],
    });
  });
});


