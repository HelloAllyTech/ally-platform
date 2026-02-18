import React from 'react';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';
import {useSelector} from 'react-redux';

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
} from '@/assets';
import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {
  AchievementsScreen,
  CallLogScreen,
  CommunityScreen,
  LeaderboardScreen,
  ReviewScreen,
  SearchScreen,
  SimulationsScreen,
  UserAnalyticsScreen,
} from '@/screens';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme';

const Tab = createBottomTabNavigator();

const ALL_TABS = [
  {
    name: SCREEN_NAMES.LEARN,
    component: SimulationsScreen,
    requiredPermissions: [USER_PERMISSIONS.EDIT_SCENARIO_SESSION],
  },
  {
    name: SCREEN_NAMES.CALL_LOG,
    component: CallLogScreen,
    requiredPermissions: [
      USER_PERMISSIONS.VIEW_CALL_LOGS,
      USER_PERMISSIONS.VIEW_SCENARIO_SESSION,
    ],
  },
  {
    name: SCREEN_NAMES.REVIEW,
    component: ReviewScreen,
    requiredPermissions: [USER_PERMISSIONS.VIEW_REVIEWS],
  },
  {
    name: SCREEN_NAMES.USER_ANALYTICS,
    component: UserAnalyticsScreen,
    requiredPermissions: [USER_PERMISSIONS.VIEW_ANALYTICS_DASHBOARD],
  },
  {
    name: SCREEN_NAMES.LEADERBOARD,
    component: LeaderboardScreen,
    requiredPermissions: [USER_PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD],
  },
  {
    name: SCREEN_NAMES.ACHIEVEMENTS,
    component: AchievementsScreen,
    requiredPermissions: [USER_PERMISSIONS.VIEW_USER_BADGES],
  },
  {
    name: SCREEN_NAMES.SEARCH,
    component: SearchScreen,
    requiredPermissions: [USER_PERMISSIONS.VIEW_REFERENCE_DOCUMENT],
  },
  {
    name: SCREEN_NAMES.COMMUNITY,
    component: CommunityScreen,
    requiredPermissions: [USER_PERMISSIONS.VIEW_COMMUNITY],
  },
];

/**
 * Returns the first visible tab name based on user permissions
 * @param permissions - Array of user permissions
 * @returns The name of the first visible tab or SEARCH as fallback
 */
export const getFirstVisibleTab = (permissions: string[]) => {
  const visibleTabs = ALL_TABS.filter(
    tab =>
      tab?.requiredPermissions?.length === 0 ||
      tab?.requiredPermissions?.some(permission =>
        permissions.includes(permission),
      ),
  );
  return visibleTabs[0]?.name ?? SCREEN_NAMES.SEARCH;
};

export const isReviewerOnly = (permissions: string[]): boolean =>
  permissions.includes(USER_PERMISSIONS.VIEW_USER_BADGES) &&
  !permissions.includes(USER_PERMISSIONS.VIEW_COMMUNITY_LEADERBOARD);

interface BottomTabsProps {
  hideTabBar?: boolean;
}

const CustomTabBar = (props: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();

  const renderTabBarIcon = (route: string, focused: boolean) => {
    const focusedIcons = {
      [SCREEN_NAMES.CALL_LOG]: <CallLogActiveIcon />,
      [SCREEN_NAMES.USER_ANALYTICS]: <AnalyticsActiveIcon />,
      [SCREEN_NAMES.COMMUNITY]: <CommunityActiveIcon />,
      [SCREEN_NAMES.LEADERBOARD]: <LeaderboardActiveIcon />,
      [SCREEN_NAMES.SEARCH]: <SearchActiveIcon />,
      [SCREEN_NAMES.LEARN]: <LearnActiveIcon />,
      [SCREEN_NAMES.REVIEW]: <ReviewActiveIcon />,
      [SCREEN_NAMES.ACHIEVEMENTS]: <BadgeActiveIcon width={20} height={20} />,
    };

    const unfocusedIcons = {
      [SCREEN_NAMES.CALL_LOG]: <CallLogInactiveIcon />,
      [SCREEN_NAMES.USER_ANALYTICS]: <AnalyticsInactiveIcon />,
      [SCREEN_NAMES.COMMUNITY]: <CommunityInactiveIcon />,
      [SCREEN_NAMES.LEADERBOARD]: <LeaderboardInactiveIcon />,
      [SCREEN_NAMES.SEARCH]: <SearchInactiveIcon />,
      [SCREEN_NAMES.LEARN]: <LearnInactiveIcon />,
      [SCREEN_NAMES.REVIEW]: <ReviewInactiveIcon />,
      [SCREEN_NAMES.ACHIEVEMENTS]: <BadgeInactiveIcon width={20} height={20} />,
    };

    return focused
      ? focusedIcons[route as keyof typeof focusedIcons]
      : unfocusedIcons[route as keyof typeof unfocusedIcons];
  };

  return (
    <View
      style={[
        styles.tabBar,
        {paddingBottom: insets.bottom},
        props.state.routes?.length < 3 && styles.smallTabBar, // For less number items in tabbar
      ]}>
      {props.state.routes.map((route, index) => {
        const isFocused = props.state.index === index;

        return (
          <TouchableOpacity
            key={route.name}
            onPress={() => props.navigation.navigate(route.name)}
            style={[styles.tabItem, {marginTop: insets.bottom}]}>
            {renderTabBarIcon(route.name, isFocused)}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export const BottomTabs: React.FC<BottomTabsProps> = () => {
  const renderCustomTabBar = (props: BottomTabBarProps) => {
    return <CustomTabBar {...props} />;
  };

  const userLoading = useSelector((s: AppRootState) => s.user.loading);
  const permissions = useSelector((s: AppRootState) => s.user.permissions);

  if (userLoading) {
    return null;
  }

  const visibleTabs = ALL_TABS.filter(tab => {
    // Check if user has permission for this tab
    const hasPermission =
      !tab.requiredPermissions?.length ||
      tab.requiredPermissions.some(permission =>
        permissions.includes(permission),
      );

    if (!hasPermission) return false;

    // Show Achievements tab only for reviewer-only users (no Leaderboard access)
    if (tab.name === SCREEN_NAMES.ACHIEVEMENTS) {
      return isReviewerOnly(permissions);
    }

    return true;
  });

  const initial = getFirstVisibleTab(permissions);

  return (
    <View style={styles.container}>
      <Tab.Navigator
        tabBar={renderCustomTabBar}
        detachInactiveScreens
        screenOptions={{
          headerShown: false,
          lazy: true,
        }}
        initialRouteName={initial}>
        {visibleTabs.map(tab => (
          <Tab.Screen
            key={tab.name}
            name={tab.name}
            component={tab.component}
          />
        ))}
      </Tab.Navigator>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    height: '60@ms',
    borderRadius: '40@ms',
    marginHorizontal: '40@ms',
    minWidth: '200@ms',
    marginBottom: '30@ms',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderWidth: 0.5,
    borderColor: colors.lightGray2,
    elevation: 3,
  },
  smallTabBar: {
    marginHorizontal: '80@ms',
  },
  tabItem: {
    flex: 1,
    height: '100%',
    minHeight: '60@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
