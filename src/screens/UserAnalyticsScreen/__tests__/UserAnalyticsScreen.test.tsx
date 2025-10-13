import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';

import {UserAnalyticsScreen} from '../UserAnalyticsScreen';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
  useTabBackToHomeHandler: () => {},
}));

// Mock components used inside the screen to isolate behavior
jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    DateSelector: ({dateRange}: any) => (
      <View testID="date-selector" accessibilityLabel={JSON.stringify(dateRange)} />
    ),
    LoadingSkeleton: () => <View testID="loading-skeleton" />,
  };
});

// Mock analytics API used in the screen
jest.mock('@/services/analyticsApi', () => ({
  useGetDashboardsQuery: () => ({data: [], isLoading: false, error: undefined}),
  useLazyGetDashboardUrlQuery: () => [jest.fn()],
}));

// Mock WebView since native module is not present in Jest
jest.mock('react-native-webview', () => 'WebView');

describe('UserAnalyticsScreen', () => {
  it('renders without crashing with no dashboards', () => {
    const {toJSON} = render(<UserAnalyticsScreen />);
    expect(toJSON()).toBeTruthy();
  });
});


