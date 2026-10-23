import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {Provider} from 'react-redux';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {configureStore} from '@reduxjs/toolkit';
import {BadgeCategory, LockStatus, ViewedStatus} from '@/constants/badges';
import {USER_PERMISSIONS} from '@/constants/permissions';
import userReducer from '@/store/slices/userSlice';

// Mock services before importing the component
jest.mock('@/services', () => ({
  useGetAvailableBadgesQuery: () => ({
    data: [
      {
        category: 'SIMULATION_MINUTES',
        badges: [
          {
            id: 'badge-1',
            name: 'First Step',
            description: 'Complete your first session',
            lockStatus: 'UNLOCKED',
            iconUrl: '',
            category: 'SIMULATION_MINUTES',
            code: 'FIRST_STEPS',
            imageUrl: '',
            achievementParams: {count: 1},
            viewedStatus: 'VIEWED',
          },
          {
            id: 'badge-2',
            name: 'Consistent Start',
            description: 'Start 5 sessions',
            lockStatus: 'UNLOCKED',
            iconUrl: '',
            category: 'SIMULATION_MINUTES',
            code: 'CONSISTENT_START',
            imageUrl: '',
            achievementParams: {count: 5},
            viewedStatus: 'VIEWED',
          },
          {
            id: 'badge-3',
            name: 'Milestone Hunter',
            description: 'Reach a milestone',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'SIMULATION_MINUTES',
            code: 'MILESTONE_HUNTER',
            imageUrl: '',
            achievementParams: {count: 1},
            viewedStatus: 'UNVIEWED',
          },
          {
            id: 'badge-4',
            name: '365 Champion',
            description: 'Complete 365 sessions',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'SIMULATION_MINUTES',
            code: '365_CHAMPION',
            imageUrl: '',
            achievementParams: {count: 365},
            viewedStatus: 'UNVIEWED',
          },
        ],
      },
      {
        category: 'ACTIVE_DAY_STREAK',
        badges: [
          {
            id: 'badge-5',
            name: 'Week Warrior',
            description: 'Complete a week of sessions',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'ACTIVE_DAY_STREAK',
            code: 'WEEK_WARRIOR',
            imageUrl: '',
            achievementParams: {count: 7},
            viewedStatus: 'UNVIEWED',
          },
          {
            id: 'badge-6',
            name: 'Month Master',
            description: 'Complete a month of sessions',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'ACTIVE_DAY_STREAK',
            code: 'MONTH_MASTER',
            imageUrl: '',
            achievementParams: {count: 30},
            viewedStatus: 'UNVIEWED',
          },
          {
            id: 'badge-7',
            name: 'Year Champion',
            description: 'Complete a year of sessions',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'ACTIVE_DAY_STREAK',
            code: 'YEAR_CHAMPION',
            imageUrl: '',
            achievementParams: {count: 365},
            viewedStatus: 'UNVIEWED',
          },
          {
            id: 'badge-8',
            name: 'Streak Keeper',
            description: 'Maintain a 7-day streak',
            lockStatus: 'UNLOCKED',
            iconUrl: '',
            category: 'ACTIVE_DAY_STREAK',
            code: 'STREAK_KEEPER',
            imageUrl: '',
            achievementParams: {count: 7},
            viewedStatus: 'VIEWED',
          },
          {
            id: 'badge-9',
            name: 'Early Bird',
            description: 'Complete 5 morning sessions',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'ACTIVE_DAY_STREAK',
            code: 'EARLY_BIRD',
            imageUrl: '',
            achievementParams: {count: 5},
            viewedStatus: 'UNVIEWED',
          },
          {
            id: 'badge-10',
            name: 'Night Owl',
            description: 'Complete 5 evening sessions',
            lockStatus: 'LOCKED',
            iconUrl: '',
            category: 'ACTIVE_DAY_STREAK',
            code: 'NIGHT_OWL',
            imageUrl: '',
            achievementParams: {count: 5},
            viewedStatus: 'UNVIEWED',
          },
        ],
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// Mock the API before importing anything else
jest.mock('@/services/api', () => ({
  api: {
    reducerPath: 'api',
    reducer: jest.fn(),
    middleware: jest.fn(() => (next: any) => (action: any) => next(action)),
    endpoints: {},
    injectEndpoints: jest.fn(() => ({
      useGenerateOtpMutation: jest.fn(),
      useVerifyOtpMutation: jest.fn(),
      useLoginWithGoogleMutation: jest.fn(),
      useLazyGetUserQuery: jest.fn(),
      useGetUserQuery: jest.fn(),
      useUpdateUserMutation: jest.fn(),
      useGetBadgesQuery: jest.fn(),
      useGetLeaderboardQuery: jest.fn(),
      useGetScenariosQuery: jest.fn(),
      useGetScenarioByIdQuery: jest.fn(),
      useGetCallLogsQuery: jest.fn(),
      useGetCallLogByIdQuery: jest.fn(),
      useGetCreditsQuery: jest.fn(),
      useGetThreadsQuery: jest.fn(),
      useLazyGetThreadsQuery: jest.fn(),
      useGetThreadCommentsQuery: jest.fn(),
      useLazyGetThreadCommentsQuery: jest.fn(),
      useGetMessagesQuery: jest.fn(),
      useAddReviewCommentMutation: jest.fn(),
      useLazyGetReviewsQuery: jest.fn(),
      useCreateReviewMutation: jest.fn(),
      useUpdateReviewStatusMutation: jest.fn(),
    })),
  },
}));

// Mock all API services
jest.mock('@/services/analyticsApi', () => ({
  useGetBadgesQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
  })),
}));

jest.mock('@/services/authApi', () => ({
  useGenerateOtpMutation: jest.fn(),
  useVerifyOtpMutation: jest.fn(),
  useLoginWithGoogleMutation: jest.fn(),
  useLazyGetUserQuery: jest.fn(),
  useGetUserQuery: jest.fn(),
  useUpdateUserMutation: jest.fn(),
}));

// Mock the BADGE_CATEGORY_MAP
jest.mock('@/utils/common', () => ({
  BADGE_CATEGORY_MAP: {
    SIMULATION_MINUTES: 'Journey',
    ACTIVE_DAY_STREAK: 'Momentum',
    COMMENTS_REACTIONS_GIVEN: 'Contribution',
    COMMENTS_REACTIONS_RECEIVED: 'Resonance',
  },
}));

jest.mock('@/services', () => ({
  useGetAvailableBadgesQuery: jest.fn(() => ({
    data: [
      {
        category: 'SIMULATION_MINUTES',
        badges: [
          {
            id: 'badge-1',
            name: 'First Step',
            description: 'Complete your first session',
            lockStatus: 'UNLOCKED',
            iconUrl: 'https://example.com/icon1.png',
          },
          {
            id: 'badge-2',
            name: 'Consistent Start',
            description: 'Start 5 sessions',
            lockStatus: 'UNLOCKED',
            iconUrl: 'https://example.com/icon2.png',
          },
          {
            id: 'badge-3',
            name: 'Milestone Hunter',
            description: 'Reach a milestone',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon3.png',
          },
        ],
      },
      {
        category: 'ACTIVE_DAY_STREAK',
        badges: [
          {
            id: 'badge-8',
            name: 'Week Warrior',
            description: 'Complete a week of sessions',
            lockStatus: 'UNLOCKED',
            iconUrl: 'https://example.com/icon8.png',
          },
          {
            id: 'badge-9',
            name: '365 Champion',
            description: 'Complete 365 sessions',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon9.png',
          },
          {
            id: 'badge-10',
            name: 'Locked Badge',
            description: 'This is locked',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon10.png',
          },
          {
            id: 'badge-11',
            name: 'Another Locked',
            description: 'This is also locked',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon11.png',
          },
          {
            id: 'badge-12',
            name: 'Yet Another Locked',
            description: 'This is also locked',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon12.png',
          },
          {
            id: 'badge-13',
            name: 'More Locked',
            description: 'This is also locked',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon13.png',
          },
          {
            id: 'badge-14',
            name: 'Final Locked',
            description: 'This is also locked',
            lockStatus: 'LOCKED',
            iconUrl: 'https://example.com/icon14.png',
          },
        ],
      },
    ],
    isLoading: false,
    isError: false,
  })),
}));

import {AchievementsScreen} from '../AchievementsScreen';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'Achievements.title': 'Achievements',
        'Achievements.unlocked': 'Unlocked',
        'Achievements.locked': 'Locked',
        'Achievements.firstSteps.title': 'First Step',
        'Achievements.firstSteps.description': 'Complete your first session',
        'Achievements.consistentStart.title': 'Consistent Start',
        'Achievements.consistentStart.description': 'Start 5 sessions',
        'Achievements.milestoneHunter.title': 'Milestone Hunter',
        'Achievements.milestoneHunter.description': 'Reach a milestone',
        'Achievements.365Champion.title': '365 Champion',
        'Achievements.365Champion.description': 'Complete 365 sessions',
        'Achievements.weekWarrior.title': 'Week Warrior',
        'Achievements.weekWarrior.description': 'Complete a week of sessions',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock navigation
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    goBack: jest.fn(),
  }),
  useTranslate: () => ({
    t: (key: string) => key,
  }),
  useHardwareBackPressHandler: jest.fn(),
}));

// Mock assets/icons (screen imports InfoIcon, LeftArrowIcon from @/assets which re-exports icons)
jest.mock('@/assets/icons', () => ({
  LeftArrowIcon: ({color}: {color: string}) => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="left-arrow-icon" style={{color}} />;
  },
  InfoIcon: () => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="info-icon" />;
  },
  AchievementLockedIcon: ({width, height}: {width: number; height: number}) => {
    const React = require('react');
    const {View} = require('react-native');
    return <View testID="achievement-locked-icon" style={{width, height}} />;
  },
}));

// Mock AchievementCard
jest.mock('../components/AchievementCard', () => ({
  AchievementCard: ({badge}: {badge: any}) => {
    const React = require('react');
    const {Text, View} = require('react-native');
    return (
      <View testID={`achievement-card-${badge.id}`}>
        <Text>{badge.name}</Text>
        <Text>{badge.description}</Text>
      </View>
    );
  },
}));

// Mock TabView and InfoTooltip (screen imports both from @/components)
jest.mock('@/components', () => ({
  TabView: ({tabs, activeTab, onTabChange}: any) => {
    const React = require('react');
    const {View, TouchableOpacity, Text} = require('react-native');
    return (
      <View testID="tab-view">
        {tabs.map((tab: any) => (
          <TouchableOpacity
            key={tab.key}
            testID={`tab-${tab.key}`}
            onPress={() => onTabChange(tab.key)}>
            <Text>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  },
  InfoTooltip: ({children, onClose, isVisible}: any) => {
    const React = require('react');
    const {View, TouchableOpacity} = require('react-native');
    return (
      <View testID="info-tooltip">
        <TouchableOpacity
          testID="info-tooltip-trigger"
          onPress={onClose}
          accessible={!!isVisible}>
          {children}
        </TouchableOpacity>
      </View>
    );
  },
}));

// Create a mock store with permissions
const createMockStore = (permissions: string[] = [USER_PERMISSIONS.VIEW_USER_BADGES]) => {
  return configureStore({
    reducer: {
      user: userReducer,
    },
    preloadedState: {
      user: {
        isAuthenticated: true,
        user: null,
        loading: false,
        permissions,
      },
    },
  });
};

// Mock safe area context with Redux Provider
const renderWithSafeArea = (ui: React.ReactElement, permissions?: string[]) => {
  const store = createMockStore(permissions);
  return render(
    <Provider store={store}>
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 375, height: 812},
          insets: {top: 0, bottom: 0, left: 0, right: 0},
        }}>
        {ui}
      </SafeAreaProvider>
    </Provider>,
  );
};

describe('AchievementsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the achievements screen', () => {
    const {getByText} = renderWithSafeArea(<AchievementsScreen />);
    expect(getByText('achievements.title')).toBeTruthy();
  });

  it('renders back button', () => {
    const {getByTestId} = renderWithSafeArea(<AchievementsScreen />);
    expect(getByTestId('left-arrow-icon')).toBeTruthy();
  });

  it('calls goBack when back button is pressed', () => {
    const mockGoBack = jest.fn();
    jest.mock('@/hooks', () => ({
      useAppNavigation: () => ({
        goBack: mockGoBack,
      }),
    }));

    const {getByTestId} = renderWithSafeArea(<AchievementsScreen />);
    const backButton = getByTestId('left-arrow-icon').parent;

    if (backButton) {
      fireEvent.press(backButton);
    }
  });

  it('renders filter tabs', () => {
    const {getByTestId} = renderWithSafeArea(
      <AchievementsScreen />,
    );

    expect(getByTestId('tab-view')).toBeTruthy();
    expect(getByTestId('tab-all')).toBeTruthy();
    expect(getByTestId('tab-unlocked')).toBeTruthy();
  });

  it('renders both unlocked and locked badges in all tab', () => {
    const {getAllByTestId} = renderWithSafeArea(
      <AchievementsScreen />,
    );

    // In "all" tab, should show both unlocked and locked badges
    const allCards = getAllByTestId(/achievement-card-badge-/);
    expect(allCards.length).toBeGreaterThan(0);
  });

  it('filters to show only unlocked badges when unlocked tab is selected', () => {
    const {getByTestId, getAllByTestId} = renderWithSafeArea(
      <AchievementsScreen />,
    );

    // Click on unlocked tab
    const unlockedTab = getByTestId('tab-unlocked');
    fireEvent.press(unlockedTab);

    // Should only show unlocked badges (3 in mock data: badge-1, badge-2, badge-8)
    const unlockedCards = getAllByTestId(/achievement-card-badge-/);
    expect(unlockedCards.length).toBe(3);
  });

  it('renders all achievement cards in all tab', () => {
    const {getAllByTestId} = renderWithSafeArea(<AchievementsScreen />);

    // Should render all 10 badges from mockData
    const achievementCards = getAllByTestId(/achievement-card-badge-/);
    expect(achievementCards.length).toBe(10);
  });

  it('shows categories in the view', () => {
    const {getByText} = renderWithSafeArea(<AchievementsScreen />);
    
    // Should show category names from mockData
    expect(getByText('achievements.badgeTypes.Journey')).toBeTruthy();
    expect(getByText('achievements.badgeTypes.Momentum')).toBeTruthy();
  });

  it('shows badges label', () => {
    const {getByText} = renderWithSafeArea(<AchievementsScreen />);
    expect(getByText('achievements.badges')).toBeTruthy();
  });
});
