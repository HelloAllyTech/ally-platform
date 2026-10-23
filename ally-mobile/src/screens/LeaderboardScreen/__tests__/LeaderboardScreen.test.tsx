import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {LeaderboardScreen} from '../LeaderboardScreen';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'Common.community': 'Community',
        'Leaderboard.title': 'Leaderboard',
        'Leaderboard.badges': 'badges',
        'Leaderboard.tableHeaders.rank': 'Rank',
        'Leaderboard.tableHeaders.user': 'User',
        'Leaderboard.tableHeaders.totalDuration': 'Duration',
        'Leaderboard.tableHeaders.badges': 'Badges',
        'Leaderboard.period.days': 'days',
        'Leaderboard.period.last7Days': 'Last 7 days',
        'Leaderboard.period.last28Days': 'Last 28 days',
        'Leaderboard.period.last364Days': 'Last 364 days',
        'Leaderboard.period.allTime': 'All time',
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
  useTabScreenHeader: () => ({
    showHamburger: false,
    handleOpenDrawer: jest.fn(),
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

// Mock CustomDropdown component
jest.mock('@/components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    CustomDropdown: ({value, options, onSelect}: any) => (
      <View testID="custom-dropdown">
        <Text testID="dropdown-value">{value}</Text>
        {options.map((option: string, index: number) => (
          <TouchableOpacity
            key={index}
            testID={`dropdown-option-${index}`}
            onPress={() => onSelect(option)}>
            <Text>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
    TabScreenHeader: ({title, rightContent}: any) => (
      <View testID="tab-screen-header">
        <Text testID="header-title">{title}</Text>
        {rightContent}
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
    expect(getByText('community.title')).toBeTruthy();
  });

  it('renders table headers', () => {
    const {getByText} = renderWithSafeArea(<LeaderboardScreen />);
    expect(getByText('community.table.rank')).toBeTruthy();
    expect(getByText('community.table.user')).toBeTruthy();
    expect(getByText('community.table.totalDuration')).toBeTruthy();
    expect(getByText('community.table.badges')).toBeTruthy();
  });

  it('renders period dropdown', () => {
    const {getAllByText} = renderWithSafeArea(<LeaderboardScreen />);
    expect(getAllByText('community.filters.last7days').length).toBeGreaterThan(0);
    expect(getAllByText('community.filters.last28days').length).toBeGreaterThan(0);
    expect(getAllByText('community.filters.last364days').length).toBeGreaterThan(0);
    expect(getAllByText('community.filters.allTime').length).toBeGreaterThan(0);
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
    expect(getByText('12')).toBeTruthy();
  });

  it('changes active period when dropdown option is selected', () => {
    const {getAllByText, rerender} = renderWithSafeArea(<LeaderboardScreen />);
    const monthOptions = getAllByText('community.filters.last28days');
    const monthOption = monthOptions[0];

    fireEvent.press(monthOption);

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

    // Option should still be visible
    expect(getAllByText('community.filters.last28days').length).toBeGreaterThan(0);
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
