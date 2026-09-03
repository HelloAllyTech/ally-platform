import React from 'react';
import {render} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

const mockState = {
  progress: undefined as any,
  isLoading: false,
  isError: false,
  canViewProgress: true,
  isGateLoading: false,
};

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: jest.fn()}),
  useTabBackToHomeHandler: () => {},
  useProgressSummary: () => ({
    canViewProgress: mockState.canViewProgress,
    isGateLoading: mockState.isGateLoading,
    summary: undefined,
  }),
}));

jest.mock('@/services/progressApi', () => ({
  useGetProgressQuery: () => ({
    data: mockState.progress,
    isLoading: mockState.isLoading,
    isError: mockState.isError,
  }),
}));

jest.mock('@/components', () => {
  const {View, Text} = require('react-native');
  return {
    LevelIndicator: ({level}: any) => (
      <View testID="level-indicator">
        <Text>{String(level)}</Text>
      </View>
    ),
    TabScreenHeader: ({title}: any) => (
      <View testID="tab-screen-header">
        <Text>{title}</Text>
      </View>
    ),
  };
});

import {ProgressScreen} from '../ProgressScreen';

/** The screen reads safe-area insets, which need a provider with fixed metrics. */
const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 375, height: 812},
        insets: {top: 0, bottom: 0, left: 0, right: 0},
      }}>
      <ProgressScreen />
    </SafeAreaProvider>,
  );

const PROGRESS = {
  level: 3,
  totalXp: 425,
  xpIntoLevel: 165,
  xpToNextLevel: 91,
  nextLevelXp: 516,
  progress: 0.64,
  isMaxLevel: false,
  lifetimePracticeMinutes: 412,
  sessionsCompleted: 15,
  trackItemsCompleted: 11,
  ladder: [],
  lastLevelUpAt: null,
};

describe('ProgressScreen', () => {
  beforeEach(() => {
    mockState.progress = PROGRESS;
    mockState.isLoading = false;
    mockState.isError = false;
    mockState.canViewProgress = true;
    mockState.isGateLoading = false;
  });

  it('shows the level and what is left to the next one', () => {
    const {getByTestId} = renderScreen();

    expect(getByTestId('progress-hero')).toBeTruthy();
    expect(getByTestId('progress-next-level')).toHaveTextContent(
      'progress.hero.toNextLevel',
    );
  });

  it('leads with cumulative totals that cannot go down', () => {
    const {getByTestId} = renderScreen();

    expect(getByTestId('progress-stat-minutes')).toHaveTextContent(/412/);
    expect(getByTestId('progress-stat-sessions')).toHaveTextContent(/15/);
    expect(getByTestId('progress-stat-track-items')).toHaveTextContent(/11/);
  });

  it('swaps the next-level target for a finished message at the top of the ladder', () => {
    mockState.progress = {
      ...PROGRESS,
      level: 10,
      isMaxLevel: true,
      xpToNextLevel: null,
      nextLevelXp: null,
    };

    const {getByTestId} = renderScreen();

    expect(getByTestId('progress-next-level')).toHaveTextContent(
      'progress.hero.maxLevel',
    );
    // A null target must never reach the screen as the string "null".
    expect(getByTestId('progress-next-level')).not.toHaveTextContent('null');
  });

  it('shows the error state rather than an empty dashboard when the load fails', () => {
    mockState.isError = true;
    mockState.progress = undefined;

    const {queryByTestId, getByText} = renderScreen();

    expect(queryByTestId('progress-hero')).toBeNull();
    expect(getByText('progress.errors.description')).toBeTruthy();
  });

  it('shows the spinner while the org gate is still resolving', () => {
    mockState.isGateLoading = true;
    mockState.canViewProgress = false;
    mockState.progress = undefined;

    const {getByTestId, queryByTestId} = renderScreen();

    expect(getByTestId('progress-loading')).toBeTruthy();
    expect(queryByTestId('progress-hero')).toBeNull();
  });
});
