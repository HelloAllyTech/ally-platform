import React from 'react';
import {render, waitFor} from '@testing-library/react-native';
import {Text} from 'react-native';

import {useForceUpdate} from '../useForceUpdate';

jest.mock('react-native-version-check', () => ({
  __esModule: true,
  default: {
    getCurrentVersion: jest.fn(() => '1.0.0'),
    getLatestVersion: jest.fn(async () => '1.2.0'),
    needUpdate: jest.fn(async () => ({isNeeded: true})),
  },
}));

const TestComponent = () => {
  const {versionInfo, isLoading, error} = useForceUpdate();
  return (
    <>
      <Text testID="loading">{String(isLoading)}</Text>
      <Text testID="error">{String(Boolean(error))}</Text>
      <Text testID="current">{versionInfo?.currentVersion || ''}</Text>
      <Text testID="latest">{versionInfo?.latestVersion || ''}</Text>
      <Text testID="required">{String(versionInfo?.isUpdateRequired || false)}</Text>
      <Text testID="available">{String(versionInfo?.isUpdateAvailable || false)}</Text>
    </>
  );
};

describe('useForceUpdate', () => {
  it('fetches version info on mount and sets flags', async () => {
    const {getByTestId} = render(<TestComponent />);

    // Initially loading may be true or false depending on timing; just wait for final state
    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
      expect(getByTestId('error').props.children).toBe('false');
      expect(getByTestId('current').props.children).toBe('1.0.0');
      expect(getByTestId('latest').props.children).toBe('1.2.0');
      expect(getByTestId('required').props.children).toBe('true');
      expect(getByTestId('available').props.children).toBe('true');
    });
  });
});


