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
    expect(getByText('CallSummaryUnauthorized.title')).toBeTruthy();
    expect(getByText('CallSummaryUnauthorized.description')).toBeTruthy();
    expect(getByText('Common.offline.goBack')).toBeTruthy();
  });

  it('invokes onGoBack on button press', () => {
    const onGoBack = jest.fn();
    const {getByText} = render(<SummaryUnauthorized onGoBack={onGoBack} />);
    fireEvent.press(getByText('Common.offline.goBack'));
    expect(onGoBack).toHaveBeenCalled();
  });
});


