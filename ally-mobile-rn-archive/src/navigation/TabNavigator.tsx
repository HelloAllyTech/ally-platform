import React from 'react';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';
import {useSelector} from 'react-redux';

import {SCREEN_NAMES} from '@/constants';
import {
  getFirstVisibleTab,
  isReviewerOnly,
  TAB_CONFIG,
  TabConfig,
} from '@/constants/tabs';
import {useGetUnreadSimulationReviewCountQuery} from '@/services/reviewsApi';
import {useGetUnreadScribeReviewCountQuery} from '@/services/scribeReviewsApi';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme';

const Tab = createBottomTabNavigator();

export {getFirstVisibleTab} from '@/constants/tabs';
export {isReviewerOnly} from '@/constants/tabs';

interface BottomTabsProps {
  hideTabBar?: boolean;
}

interface CustomTabBarProps extends BottomTabBarProps {
  visibleTabs: TabConfig[];
}

const CustomTabBar = (props: CustomTabBarProps) => {
  const insets = useSafeAreaInsets();
  const {visibleTabs} = props;

  const {data: simUnread} = useGetUnreadSimulationReviewCountQuery();
  const {data: scribeUnread} = useGetUnreadScribeReviewCountQuery();
  const hasUnreadReviews =
    (simUnread?.count ?? 0) + (scribeUnread?.count ?? 0) > 0;

  const renderTabBarIcon = (routeName: string, focused: boolean) => {
    const tab = visibleTabs.find(t => t.name === routeName);
    if (!tab) return null;
    const icon = focused ? tab.focusedIcon : tab.unfocusedIcon;
    if (routeName === SCREEN_NAMES.REVIEW && hasUnreadReviews) {
      return (
        <View>
          {icon}
          <View style={styles.unreadBadge} />
        </View>
      );
    }
    return icon;
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
  const userLoading = useSelector((s: AppRootState) => s.user.loading);
  const permissions = useSelector((s: AppRootState) => s.user.permissions);

  if (userLoading) {
    return null;
  }

  const visibleTabs = TAB_CONFIG.filter(tab => {
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

  const renderCustomTabBar = (tabBarProps: BottomTabBarProps) => (
    <CustomTabBar {...tabBarProps} visibleTabs={visibleTabs} />
  );

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
  unreadBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: ms(8),
    height: ms(8),
    borderRadius: ms(4),
    backgroundColor: colors.ds.theme.primary,
  },
  tabItem: {
    flex: 1,
    height: '100%',
    minHeight: '60@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
