import React from 'react';
import {render} from '@testing-library/react-native';

import {SummaryDropdown} from '../SummaryDropdown';

jest.mock('@/assets/icons', () => ({
  CallIcon: () => null,
  TickIcon: () => null,
  TranscriptIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    DropdownMenu: ({items}: any) => <Text>{items[0].text}</Text>,
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('CallSummaryScreen/SummaryDropdown', () => {
  it('renders with first item text', () => {
    const {getByText} = render(
      <SummaryDropdown
        visible
        onClose={() => {}}
        showSummary
        setShowSummary={() => {}}
      />,
    );
    expect(getByText('callSummary.header.callSummary')).toBeTruthy();
  });
});


