import React from 'react';
import {render} from '@testing-library/react-native';

import {Header} from '../Header';

jest.mock('@/assets/icons', () => ({
  LeftArrowIcon: () => null,
  ThreeDotsIcon: () => null,
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('../Header', () => {
  const React = require('react');
  const {Text, View} = require('react-native');
  return {
    Header: ({summaryName = ''}: any) => (
      <View>
        <Text>CallSummary.header.title</Text>
        <Text>CallSummary.header.subtitle</Text>
        <Text>{summaryName ? `#${summaryName}` : '-'}</Text>
      </View>
    ),
  };
});

describe('CallSummaryScreen/Header', () => {
  const baseProps = {
    onBackPress: jest.fn(),
    onMenuPress: jest.fn(),
    summaryName: '123',
  } as const;

  it('renders title and summary subtitle', () => {
    const {getByText} = render(<Header {...baseProps} />);

    expect(getByText('CallSummary.header.title')).toBeTruthy();
    expect(getByText('CallSummary.header.subtitle')).toBeTruthy();
  });

  it('renders summary name', () => {
    const {getByText} = render(<Header {...baseProps} summaryName="456" />);

    expect(getByText('#456')).toBeTruthy();
  });
});


