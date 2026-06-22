import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {SummaryUnauthorized} from '../SummaryUnauthorized';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets/icons', () => ({
  EmptyTranscriptIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    Button: ({
      label,
      onPress,
    }: {
      label: string;
      onPress: () => void;
    }) => React.createElement(Text, {onPress}, label),
  };
});

describe('SummaryUnauthorized', () => {
  it('renders title, description and button', () => {
    const {getByText} = render(<SummaryUnauthorized onGoBack={jest.fn()} />);
    expect(getByText('summary.notFoundTitle')).toBeTruthy();
    expect(getByText('summary.notFoundDesc')).toBeTruthy();
    expect(getByText('achievements.backAria')).toBeTruthy();
  });

  it('invokes onGoBack on button press', () => {
    const onGoBack = jest.fn();
    const {getByText} = render(<SummaryUnauthorized onGoBack={onGoBack} />);
    fireEvent.press(getByText('achievements.backAria'));
    expect(onGoBack).toHaveBeenCalled();
  });
});


