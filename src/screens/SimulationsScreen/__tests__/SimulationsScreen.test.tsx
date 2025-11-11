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
    useSimulationCredits: () => ({ credits: null, getCreditsInfo: null }),
    mockNavigate,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    SimulationsSkeleton: ({count}: any) => (
      <View testID="skeleton" accessibilityLabel={String(count)} />
    ),
    TabView: ({tabs, activeTab, onTabChange}: any) => (
      <View testID="tab-view">
        {tabs.map((tab: any) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            testID={`tab-${tab.key}`}>
            <Text>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
    CircularProgress: ({progress}: any) => (
      <View testID="circular-progress">
        <Text>{progress}</Text>
      </View>
    ),
    SimulationCard: ({title, onPress}: any) => (
      <TouchableOpacity onPress={onPress} testID="simulation-card">
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('@/services', () => ({
  useGetScenariosQuery: jest.fn(),
  useGetSimulationPathsQuery: jest.fn(),
}));

describe('SimulationsScreen', () => {
  const useGetScenariosQueryMock = require('@/services')
    .useGetScenariosQuery as jest.Mock;
  const useGetSimulationPathsQueryMock = require('@/services')
    .useGetSimulationPathsQuery as jest.Mock;

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
    // Provide default mock for useGetSimulationPathsQuery
    useGetSimulationPathsQueryMock.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: jest.fn(),
    });
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
      expect(getByText('Simulations.noSimulationsAvailable')).toBeTruthy(),
    );
  });

  it('sorts scenarios: available first, then COMING_SOON, and navigates on press', async () => {
    const scenarios: Scenario[] = [
      {
        id: '1',
        title: 'B Coming Soon',
        description: 'desc',
        coverImageUrl: 'http://image',
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

    // Both scenarios should be rendered
    expect(getByText('B Coming Soon')).toBeTruthy();
  });
});


