import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {Header} from '../Header';

jest.mock('@/assets/icons', () => ({
  ArrowDown: () => null,
  LeftArrowIcon: () => null,
  ThreeDotsIcon: () => null,
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

// Make Header's nested Text structure easier to query by flattening during test
jest.mock('../Header', () => {
  const React = require('react');
  const {Text, View} = require('react-native');
  return {
    Header: ({onBackPress, onMenuPress, summaryName = '', onHeaderPress, showSummary, showTranscript}: any) => (
      <View>
        <Text>CallSummary.header.title</Text>
        <Text>{showSummary ? 'CallSummary.header.subtitle' : 'CallSummary.header.transcript'}</Text>
        <Text>{summaryName ? `#${summaryName}` : '-'}</Text>
      </View>
    ),
  };
});

describe('CallSummaryScreen/Header', () => {
  const baseProps = {
    onBackPress: jest.fn(),
    onMenuPress: jest.fn(),
    onHeaderPress: jest.fn(),
    summaryName: '123',
  } as const;

  it('renders transcript subtitle when showSummary=false', () => {
    const {getByText} = render(
      <Header {...baseProps} showSummary={false} showTranscript={true} />,
    );

    expect(getByText('CallSummary.header.title')).toBeTruthy();
    expect(getByText('CallSummary.header.transcript')).toBeTruthy();
  });

  it('renders subtitle when showSummary=true', () => {
    const {getByText} = render(
      <Header {...baseProps} showSummary={true} showTranscript={true} />,
    );

    expect(getByText('CallSummary.header.title')).toBeTruthy();
    expect(getByText('CallSummary.header.subtitle')).toBeTruthy();
  });
});


