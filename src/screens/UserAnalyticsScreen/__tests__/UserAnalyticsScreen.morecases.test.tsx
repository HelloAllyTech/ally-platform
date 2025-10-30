import React from 'react';
import {render, waitFor} from '@testing-library/react-native';

import {UserAnalyticsScreen} from '../UserAnalyticsScreen';

// Mock i18n hooks
jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useTabBackToHomeHandler: () => {},
  useUser: () => ({ userData: { id: 1 }, isAuthenticated: true }),
}));

// Stable component mocks
jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EmptyState: () => <View testID="empty-state" />,
    TabView: ({children}: any) => <View testID="tab-view">{children}</View>,
  };
});

jest.mock('react-native-webview', () => 'WebView');
jest.mock('@/assets/icons', () => ({DataUnavailableIcon: () => null}));

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
    expect(getByText('Analytics.failedToLoadAnalytics')).toBeTruthy();
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


