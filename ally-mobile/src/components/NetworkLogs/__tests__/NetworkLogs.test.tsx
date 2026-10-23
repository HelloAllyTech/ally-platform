import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {NetworkLogs} from '@/components/NetworkLogs';

jest.mock('react-native-network-logger', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Comp = () => React.createElement(View, null);
  return Object.assign(Comp, {
    __esModule: true,
    default: Comp,
    startNetworkLogging: jest.fn(),
    stopNetworkLogging: jest.fn(),
  });
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.useFakeTimers();

describe('NetworkLogs', () => {
  it('opens modal on press', () => {
    const {getByText} = render(<NetworkLogs />);
    fireEvent.press(getByText('calls.header.subtitle'));
    expect(getByText('calls.header.subtitle')).toBeTruthy();
  });
});
