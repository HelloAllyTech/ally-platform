import React from 'react';

import {
  AnalyticsActiveIcon,
  AnalyticsInactiveIcon,
  BadgeActiveIcon,
  BadgeInactiveIcon,
  CallLogActiveIcon,
  CallLogInactiveIcon,
  CommunityActiveIcon,
  CommunityInactiveIcon,
  LeaderboardActiveIcon,
  LeaderboardInactiveIcon,
  LearnActiveIcon,
  LearnInactiveIcon,
  ReviewActiveIcon,
  ReviewInactiveIcon,
  SearchActiveIcon,
  SearchInactiveIcon,
} from '../assets';
import {
  AchievementsScreen,
  CallLogScreen,
  CommunityScreen,
  LeaderboardScreen,
  ReviewScreen,
  SearchScreen,
  SimulationsScreen,
  UserAnalyticsScreen,
} from '../screens';
import {SCREEN_NAMES} from './navigation';
import {USER_PERMISSIONS} from './permissions';

export interface TabConfig {
  name: string;
  requiredPermissions: string[];
  component: React.ComponentType<object>;
  focusedIcon: React.ReactNode;
  unfocusedIcon: React.ReactNode;
}

export const TAB_CONFIG: TabConfig[] = [
  {
    name: SCREEN_NAMES.LEARN,
    requiredPermissions: [USER_PERMISSIONS.EDIT_SCENARIO_SESSION],
    component: SimulationsScreen,
    focusedIcon: <LearnActiveIcon />,
    unfocusedIcon: <LearnInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.CALL_LOG,
    requiredPermissions: [
      USER_PERMISSIONS.VIEW_CALL_LOGS,
      USER_PERMISSIONS.VIEW_SCENARIO_SESSION,
    ],
    component: CallLogScreen,
    focusedIcon: <CallLogActiveIcon />,
    unfocusedIcon: <CallLogInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.REVIEW,
    requiredPermissions: [
      USER_PERMISSIONS.VIEW_SIMULATION_REVIEWS,
      USER_PERMISSIONS.VIEW_SCRIBE_REVIEWS,
    ],
    component: ReviewScreen,
    focusedIcon: <ReviewActiveIcon />,
    unfocusedIcon: <ReviewInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.USER_ANALYTICS,
    requiredPermissions: [USER_PERMISSIONS.VIEW_ANALYTICS_DASHBOARD],
    component: UserAnalyticsScreen,
    focusedIcon: <AnalyticsActiveIcon />,
    unfocusedIcon: <AnalyticsInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.LEADERBOARD,
    requiredPermissions: [USER_PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD],
    component: LeaderboardScreen,
    focusedIcon: <LeaderboardActiveIcon />,
    unfocusedIcon: <LeaderboardInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.ACHIEVEMENTS,
    requiredPermissions: [USER_PERMISSIONS.VIEW_USER_BADGES],
    component: AchievementsScreen,
    focusedIcon: <BadgeActiveIcon />,
    unfocusedIcon: <BadgeInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.SEARCH,
    requiredPermissions: [USER_PERMISSIONS.VIEW_REFERENCE_DOCUMENT],
    component: SearchScreen,
    focusedIcon: <SearchActiveIcon />,
    unfocusedIcon: <SearchInactiveIcon />,
  },
  {
    name: SCREEN_NAMES.COMMUNITY,
    requiredPermissions: [USER_PERMISSIONS.VIEW_COMMUNITY],
    component: CommunityScreen,
    focusedIcon: <CommunityActiveIcon />,
    unfocusedIcon: <CommunityInactiveIcon />,
  },
];

/**
 * Returns the first visible tab name based on user permissions.
 */
export const getFirstVisibleTab = (permissions: string[]): string => {
  const visibleTabs = TAB_CONFIG.filter(
    tab =>
      tab.requiredPermissions.length === 0 ||
      tab.requiredPermissions.some(permission =>
        permissions.includes(permission),
      ),
  );
  return visibleTabs[0]?.name ?? SCREEN_NAMES.SEARCH;
};

export const isReviewerOnly = (permissions: string[]): boolean =>
  permissions.includes(USER_PERMISSIONS.VIEW_USER_BADGES) &&
  !permissions.includes(USER_PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD);
