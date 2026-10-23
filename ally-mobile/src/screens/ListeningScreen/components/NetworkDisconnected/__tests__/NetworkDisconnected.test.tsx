import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {NetworkDisconnected} from '../NetworkDisconnected';
import {DisconnectedType} from '@/types';

jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({ t: (k: string) => k }),
  useNetworkConnectivity: () => ({ isOffline: false }),
}));

jest.mock('@/components', () => ({
  __esModule: true,
  Button: ({label, onPress}: any) => {
    const React = require('react');
    const {TouchableOpacity, Text} = require('react-native');
    return (
      <TouchableOpacity onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    );
  },
}));

jest.mock('@/assets', () => ({
  __esModule: true,
  NetworkDisconnectedIcon: () => null,
}));

describe('NetworkDisconnected', () => {
  it('renders title and description based on type and triggers buttons', () => {
    const onRetry = jest.fn();
    const onGoBack = jest.fn();
    const {getByText} = render(
      <NetworkDisconnected
        onRetry={onRetry}
        onGoBack={onGoBack}
        disconnectedType={DisconnectedType.NETWORK}
      />,
    );

    expect(getByText('common.offline.networkTitle')).toBeTruthy();
    expect(getByText('common.offline.networkDescription')).toBeTruthy();

    fireEvent.press(getByText('common.offline.tryAgain'));
    fireEvent.press(getByText('common.offline.goBack'));

    expect(onRetry).toHaveBeenCalled();
    expect(onGoBack).toHaveBeenCalled();
  });
});


