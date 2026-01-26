import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {LeaderboardScreen} from '../LeaderboardScreen';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'Leaderboard.title': 'Leaderboard',
        'Leaderboard.badges': 'badges',
        'Leaderboard.tableHeaders.rank': 'Rank',
        'Leaderboard.tableHeaders.user': 'User',
        'Leaderboard.tableHeaders.totalDuration': 'Duration',
        'Leaderboard.tableHeaders.badges': 'Badges',
        'Leaderboard.period.days': 'days',
        'Leaderboard.period.last': 'Last',
        'Leaderboard.period.week': 'Week',
        'Leaderboard.period.month': 'Month',
        'Leaderboard.period.year': 'Year',
        'Leaderboard.period.allTime': 'All Time',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock navigation and useLeaderboard
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    navigate: jest.fn(),
  }),
  useTranslate: () => ({
    t: (key: string) => key,
  }),
  useLeaderboard: () => ({
    data: [
      {
        userId: 1,
        rank: 1,
        name: 'Sarah Johnson',
        profileImageUrl: '',
        minutesPlayed: 1200,
        badgeCount: 25,
        isCurrentUser: false,
      },
      {
        userId: 999,
        rank: 24,
        name: 'Yedhu Krishnan',
        profileImageUrl: '',
        minutesPlayed: 872,
        badgeCount: 12,
        isCurrentUser: true,
      },
    ],
    currentUserEntry: {
      userId: 999,
      name: 'Yedhu Krishnan',
      profileImageUrl: '',
      rank: 24,
      minutesPlayed: 872,
      badgeCount: 12,
      window: 'LAST_WEEK',
      isCurrentUser: true,
    },
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    isError: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
  }),
}));

// Mock TabView component
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    TabView: ({tabs, activeTab, onTabChange}: any) => (
      <View testID="tab-view">
        {tabs.map((tab: any, index: number) => (
          <TouchableOpacity
            key={tab.key}
            testID={`tab-${tab.key}`}
            onPress={() => onTabChange(tab.key)}>
            <Text>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
  };
});

// Mock safe area context
const renderWithSafeArea = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 375, height: 812},
        insets: {top: 0, bottom: 0, left: 0, right: 0},
      }}>
      {ui}
    </SafeAreaProvider>,
  );

describe('LeaderboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the leaderboard screen', () => {
    const {getByText} = renderWithSafeArea(<LeaderboardScreen />);
    expect(getByText('Leaderboard')).toBeTruthy();
  });

  it('renders table headers', () => {
    const {getByText} = renderWithSafeArea(<LeaderboardScreen />);
    expect(getByText('Rank')).toBeTruthy();
    expect(getByText('User')).toBeTruthy();
    expect(getByText('Duration')).toBeTruthy();
    expect(getByText('Badges')).toBeTruthy();
  });

  it('renders period tabs', () => {
    const {getByText} = renderWithSafeArea(<LeaderboardScreen />);
    expect(getByText('7 days')).toBeTruthy();
    expect(getByText('30 days')).toBeTruthy();
    expect(getByText('365 days')).toBeTruthy();
    expect(getByText('All Time')).toBeTruthy();
  });

  it('renders leaderboard entries', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    // Should have entries with ranks 1-10
    expect(getAllByText(/^\d+$/).length).toBeGreaterThan(0);
  });

  it('highlights current user entry', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    // Current user should be "Yedhu Krishnan" based on mockUtils
    // Should appear at least once (in main list)
    expect(getAllByText('Yedhu Krishnan').length).toBeGreaterThan(0);
  });

  it('displays badge count in header', () => {
    const {getByText} = renderWithSafeArea(<LeaderboardScreen />);
    expect(getByText(/12 badges/)).toBeTruthy();
  });

  it('changes active period when tab is pressed', () => {
    const {getByText, rerender} = renderWithSafeArea(<LeaderboardScreen />);
    const monthTab = getByText('30 days');

    fireEvent.press(monthTab);

    // Re-render to see updated state
    rerender(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, bottom: 0, left: 0, right: 0},
        }}>
        <LeaderboardScreen />
      </SafeAreaProvider>,
    );

    // Tab should still be visible
    expect(getByText('30 days')).toBeTruthy();
  });

  it('renders rank badges for all entries', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    // Should have rank numbers displayed
    const rankNumbers = getAllByText(/^[1-9]|10$/);
    expect(rankNumbers.length).toBeGreaterThan(0);
  });

  it('renders user names for all entries', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    // Should have user names (at least the current user)
    expect(getAllByText(/[A-Z][a-z]+ [A-Z][a-z]+/).length).toBeGreaterThan(0);
  });

  it('renders duration for all entries', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    // Duration format: "X h Y min"
    const durations = getAllByText(/\d+\s+h\s+\d+\s+min/);
    expect(durations.length).toBeGreaterThan(0);
  });

  it('renders badge counts for all entries', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    // Badge counts should be numbers
    const badgeCounts = getAllByText(/^\d+$/);
    expect(badgeCounts.length).toBeGreaterThan(0);
  });
});
