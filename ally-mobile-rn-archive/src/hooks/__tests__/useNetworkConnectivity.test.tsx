import React from 'react';
import {render, waitFor} from '@testing-library/react-native';
import {Text} from 'react-native';

import {useNetworkConnectivity} from '../useNetworkConnectivity';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (cb: any) => {
      // push an initial event
      cb({isConnected: false, isInternetReachable: false});
      return () => {};
    },
    fetch: () => Promise.resolve({isConnected: true, isInternetReachable: true}),
  },
}));

const TestComponent = () => {
  const {isConnected, isInternetReachable, isOffline} = useNetworkConnectivity();
  return (
    <>
      <Text>{String(isConnected)}</Text>
      <Text>{String(isInternetReachable)}</Text>
      <Text>{String(isOffline)}</Text>
    </>
  );
};

describe('useNetworkConnectivity', () => {
  it('subscribes, fetches initial state, and computes offline flag', async () => {
    const {getAllByText, getByText} = render(<TestComponent />);
    // After subscription call (there are two "false" nodes, check count)
    expect(getAllByText('false').length).toBeGreaterThanOrEqual(2);
    expect(getByText('true')).toBeTruthy(); // offline initially true

    await waitFor(() => expect(getByText('true')).toBeTruthy());
  });
});


