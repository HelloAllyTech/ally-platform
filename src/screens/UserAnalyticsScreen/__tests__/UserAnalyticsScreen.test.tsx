import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';

import {UserAnalyticsScreen} from '../UserAnalyticsScreen';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
    tVariable: (key: string) => key,
  }),
  useTabBackToHomeHandler: () => {},
  useUser: () => ({userData: {id: 1}, isAuthenticated: true}),
  useTabScreenHeader: () => ({
    showHamburger: false,
    handleOpenDrawer: jest.fn(),
  }),
}));

// Mock components used inside the screen to isolate behavior
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    DateSelector: ({dateRange}: any) => (
      <View testID="date-selector" accessibilityLabel={JSON.stringify(dateRange)} />
    ),
    LoadingSkeleton: () => <View testID="loading-skeleton" />,
    EmptyState: () => <View testID="empty-state" />,
    TabView: () => <View testID="tab-view" />,
    TabScreenHeader: ({title, subtitle}: any) => (
      <View testID="tab-screen-header">
        <Text>{title}</Text>
        {subtitle && <Text>{subtitle}</Text>}
      </View>
    ),
  };
});

// Mock analytics API used in the screen
jest.mock('@/services/analyticsApi', () => ({
  useGetDashboardsQuery: () => ({data: [], isLoading: false, error: undefined}),
  useLazyGetDashboardUrlQuery: () => [jest.fn()],
}));

// Mock WebView since native module is not present in Jest
jest.mock('react-native-webview', () => 'WebView');

// Mock assets
jest.mock('@/assets/icons', () => ({
  DataUnavailableIcon: () => null,
}));

describe('UserAnalyticsScreen', () => {
  it('renders without crashing with no dashboards', () => {
    const {toJSON} = render(<UserAnalyticsScreen />);
    expect(toJSON()).toBeTruthy();
  });
});

// Stateful mock to allow varying scenarios without reloading React
const mockState = {
  dashboards: undefined as any,
  isLoading: true,
  error: undefined as any,
  getUrlMock: jest.fn(),
};

jest.mock('@/services/analyticsApi', () => ({
  __esModule: true,
  useGetDashboardsQuery: () => ({
    data: mockState.dashboards,
    isLoading: mockState.isLoading,
    error: mockState.error,
  }),
  useLazyGetDashboardUrlQuery: () => [mockState.getUrlMock],
}));

describe('UserAnalyticsScreen variants', () => {
  beforeEach(() => {
    mockState.dashboards = undefined;
    mockState.isLoading = true;
    mockState.error = undefined;
    mockState.getUrlMock = jest.fn();
  });

  it('shows loading while dashboards are loading', () => {
    const {UNSAFE_getAllByType} = render(<UserAnalyticsScreen />);
    expect(
      UNSAFE_getAllByType(require('react-native').ActivityIndicator).length,
    ).toBeGreaterThan(0);
  });

  it('renders error state when dashboards query fails', () => {
    mockState.isLoading = false;
    mockState.error = {} as any;
    const {getByText} = render(<UserAnalyticsScreen />);
    expect(getByText('analytics.empty.description')).toBeTruthy();
  });

  it('shows TabView for both types and renders WebViews after URLs resolve', async () => {
    mockState.isLoading = false;
    mockState.dashboards = [
      {externalId: 'a', analyticsType: 'CALL_LOG_ANALYTICS'},
      {externalId: 'b', analyticsType: 'SIMULATION_ANALYTICS'},
    ];
    mockState.getUrlMock = jest.fn(async ({dashboardId}: any) => ({
      data: {url: `https://example.com/${dashboardId}`},
    }));

    const {getByTestId, UNSAFE_getAllByType} = render(<UserAnalyticsScreen />);
    expect(getByTestId('tab-view')).toBeTruthy();
    await waitFor(() => {
      const W = require('react-native-webview');
      expect(UNSAFE_getAllByType(W).length).toBe(1);
    });
    expect(mockState.getUrlMock).toHaveBeenCalledTimes(2);
  });
});


