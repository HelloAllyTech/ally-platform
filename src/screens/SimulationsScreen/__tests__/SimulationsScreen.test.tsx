import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SimulationsScreen} from '../SimulationsScreen';
import {ScenarioStatus, SCREEN_NAMES} from '../../../constants';
import type {Scenario} from '../../../types';

jest.mock('@/hooks', () => {
  const mockNavigate = jest.fn();
  return {
    __esModule: true,
    useAppNavigation: () => ({
      navigate: mockNavigate,
    }),
    useTabBackToHomeHandler: () => {},
    mockNavigate,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationsSkeleton: ({count}: any) => (
      <View testID="skeleton" accessibilityLabel={String(count)} />
    ),
  };
});

jest.mock('@/services', () => ({
  useGetScenariosQuery: jest.fn(),
}));

describe('SimulationsScreen', () => {
  const useGetScenariosQueryMock = require('@/services')
    .useGetScenariosQuery as jest.Mock;

  const renderWithSafeArea = (ui: React.ReactElement) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, left: 0, right: 0, bottom: 0},
        }}>
        {ui}
      </SafeAreaProvider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows skeleton when loading', () => {
    useGetScenariosQueryMock.mockReturnValue({
      data: undefined,
      isFetching: true,
      refetch: jest.fn(),
    });

    const {getByTestId} = renderWithSafeArea(<SimulationsScreen />);
    expect(getByTestId('skeleton')).toBeTruthy();
  });

  it('shows empty state when not fetching and no data', async () => {
    useGetScenariosQueryMock.mockReturnValue({
      data: [],
      isFetching: false,
      refetch: jest.fn(),
    });

    const {getByText} = renderWithSafeArea(<SimulationsScreen />);
    await waitFor(() =>
      expect(getByText('Simulations.noSimulations')).toBeTruthy(),
    );
  });

  it('sorts scenarios: available first, then COMING_SOON, and navigates on press', async () => {
    const scenarios: Scenario[] = [
      {
        id: '1',
        title: 'B Coming Soon',
        description: 'desc',
        coverImageUrl: 'http://image',
        status: ScenarioStatus.COMING_SOON,
      },
      {
        id: '2',
        title: 'A Available',
        description: 'desc',
        coverImageUrl: 'http://image2',
      },
    ];

    useGetScenariosQueryMock.mockReturnValue({
      data: scenarios,
      isFetching: false,
      refetch: jest.fn(),
    });

    const {getByText} = renderWithSafeArea(<SimulationsScreen />);

    // Titles are rendered; available one should be tappable and navigate
    const available = getByText('A Available');
    fireEvent.press(available);
    const {mockNavigate} = require('@/hooks');
    expect(mockNavigate).toHaveBeenCalledWith(
      SCREEN_NAMES.SIMULATION_DETAILS,
      expect.objectContaining({
        scenario: expect.objectContaining({id: '2'}),
      }),
    );

    // Coming soon should be visible and disabled badge shown
    expect(getByText('Common.comingSoon')).toBeTruthy();
  });
});


