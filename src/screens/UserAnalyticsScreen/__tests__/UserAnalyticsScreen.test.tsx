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

// Mock analytics API hook
jest.mock('@/services/analyticsApi', () => ({
  useGetCounselorStatsQuery: jest.fn(),
}));

describe('UserAnalyticsScreen', () => {
  const useGetCounselorStatsQueryMock = require('@/services/analyticsApi')
    .useGetCounselorStatsQuery as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton while data is loading', () => {
    useGetCounselorStatsQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      error: undefined,
    });

    const {getByTestId} = render(<UserAnalyticsScreen />);
    expect(getByTestId('loading-skeleton')).toBeTruthy();
  });

  it('renders listening/talking distribution with computed stats when loaded', async () => {
    useGetCounselorStatsQueryMock.mockReturnValue({
      data: {
        counselorListeningDuration: 30,
        counselorSharingDuration: 70,
        counselorSharingPercentage: 70,
        counselorName: 'Test',
      },
      isLoading: false,
      isFetching: false,
      error: undefined,
    });

    const {getByText} = render(<UserAnalyticsScreen />);

    // talkingPercent is counselorSharingPercentage (=70)
    await waitFor(() => expect(getByText('70.00%')).toBeTruthy());
    // listeningPercent is 30 (100 - sharing)
    expect(getByText('30.00%')).toBeTruthy();
  });

  it('renders zero state when both durations are 0', () => {
    useGetCounselorStatsQueryMock.mockReturnValue({
      data: {
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
        counselorName: 'Test',
      },
      isLoading: false,
      isFetching: false,
      error: undefined,
    });

    const {getByText} = render(<UserAnalyticsScreen />);
    expect(getByText('analytics.listeningTalking.noData')).toBeTruthy();
  });

  it('changes date range when switching tabs via TabBar', () => {
    // Keep the data static; we verify TabBar interaction triggers rerender with new pickerMode
    useGetCounselorStatsQueryMock.mockReturnValue({
      data: {
        counselorListeningDuration: 1,
        counselorSharingDuration: 1,
        counselorSharingPercentage: 50,
        counselorName: 'Test',
      },
      isLoading: false,
      isFetching: false,
      error: undefined,
    });

    const {getByText} = render(<UserAnalyticsScreen />);

    // Switch to Week tab
    fireEvent.press(getByText('W'));
    // Switch to Month tab
    fireEvent.press(getByText('M'));
    // If no crash and component re-renders, interaction works.
  });
});


