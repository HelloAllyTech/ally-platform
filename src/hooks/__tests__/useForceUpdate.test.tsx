import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {useForceUpdate} from '../useForceUpdate';

jest.mock('react-native-version-check', () => ({
  __esModule: true,
  default: {
    getCurrentVersion: jest.fn(() => '1.0.0'),
  },
}));

jest.mock('@/services/appConfigApi', () => ({
  useGetForceUpdateConfigQuery: jest.fn(() => ({
    data: {
      minimumSupportedVersion: '1.2.0',
    },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  })),
}));

const TestComponent = () => {
  const {versionInfo, isLoading, error} = useForceUpdate();
  return (
    <>
      <Text testID="loading">{String(isLoading)}</Text>
      <Text testID="error">{String(Boolean(error))}</Text>
      <Text testID="current">{versionInfo?.currentVersion || ''}</Text>
      <Text testID="minimum">{versionInfo?.minimumVersion || ''}</Text>
      <Text testID="required">
        {String(versionInfo?.isUpdateRequired || false)}
      </Text>
    </>
  );
};

describe('useForceUpdate', () => {
  it('returns update required when current version is below minimum', () => {
    const {getByTestId} = render(<TestComponent />);

    expect(getByTestId('loading').props.children).toBe('false');
    expect(getByTestId('error').props.children).toBe('false');
    expect(getByTestId('current').props.children).toBe('1.0.0');
    expect(getByTestId('minimum').props.children).toBe('1.2.0');
    expect(getByTestId('required').props.children).toBe('true');
  });

  it('returns no update required when current version meets minimum', () => {
    const mockQuery =
      require('@/services/appConfigApi').useGetForceUpdateConfigQuery;
    mockQuery.mockReturnValue({
      data: {
        minimumSupportedVersion: '1.0.0',
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    const {getByTestId} = render(<TestComponent />);
    expect(getByTestId('required').props.children).toBe('false');
  });
});
