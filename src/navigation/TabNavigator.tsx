import React from 'react';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useSelector} from 'react-redux';

import {
  AnalyticsActiveIcon,
  AnalyticsInactiveIcon,
  CallLogActiveIcon,
  CallLogInactiveIcon,
  CommunityActiveIcon,
  CommunityInactiveIcon,
  LearnActiveIcon,
  LearnInactiveIcon,
  SearchActiveIcon,
  SearchInactiveIcon,
} from '@/assets';
import {SCREEN_NAMES} from '@/constants';
import {
  CallLogScreen,
  CommunityScreen,
  SearchScreen,
  SimulationsScreen,
  UserAnalyticsScreen,
} from '@/screens';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme';
import {UserRole} from '@/types';

const Tab = createBottomTabNavigator();

const ALL_TABS = [
  {
    name: SCREEN_NAMES.CALL_LOG,
    component: CallLogScreen,
    roles: [UserRole.COUNSELOR],
  },
  {
    name: SCREEN_NAMES.USER_ANALYTICS,
    component: UserAnalyticsScreen,
    roles: [UserRole.COUNSELOR],
  },
  {
    name: SCREEN_NAMES.SEARCH,
    component: SearchScreen,
    roles: [UserRole.COUNSELOR],
  },
  {
    name: SCREEN_NAMES.LEARN,
    component: SimulationsScreen,
    roles: [UserRole.COUNSELOR],
  },
  {
    name: SCREEN_NAMES.COMMUNITY,
    component: CommunityScreen,
    roles: [UserRole.COUNSELOR],
  },
];

interface BottomTabsProps {
  hideTabBar?: boolean;
}

const CustomTabBar = (props: BottomTabBarProps & BottomTabsProps) => {
  const insets = useSafeAreaInsets();

  if (props.hideTabBar) {
    return null;
  }

  const renderTabBarIcon = (route: string, focused: boolean) => {
    const focusedIcons = {
      [SCREEN_NAMES.CALL_LOG]: <CallLogActiveIcon width={18} height={18} />,
      [SCREEN_NAMES.USER_ANALYTICS]: (
        <AnalyticsActiveIcon width={18} height={18} />
      ),
      [SCREEN_NAMES.COMMUNITY]: <CommunityActiveIcon width={20} height={20} />,
      [SCREEN_NAMES.SEARCH]: (
        <SearchActiveIcon width={20} height={20} color={colors.blue} />
      ),
      [SCREEN_NAMES.LEARN]: <LearnActiveIcon width={20} height={20} />,
    };

    const unfocusedIcons = {
      [SCREEN_NAMES.CALL_LOG]: <CallLogInactiveIcon width={18} height={18} />,
      [SCREEN_NAMES.USER_ANALYTICS]: (
        <AnalyticsInactiveIcon width={18} height={18} />
      ),
      [SCREEN_NAMES.COMMUNITY]: (
        <CommunityInactiveIcon width={20} height={20} />
      ),
      [SCREEN_NAMES.SEARCH]: <SearchInactiveIcon width={20} height={20} />,
      [SCREEN_NAMES.LEARN]: <LearnInactiveIcon width={20} height={20} />,
    };

    return focused
      ? focusedIcons[route as keyof typeof focusedIcons]
      : unfocusedIcons[route as keyof typeof unfocusedIcons];
  };

  return (
    <View style={[styles.tabBar, {paddingBottom: insets.bottom}]}>
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

export const BottomTabs: React.FC<BottomTabsProps> = ({hideTabBar = false}) => {
  const renderCustomTabBar = (props: BottomTabBarProps) => {
    return <CustomTabBar {...props} hideTabBar={hideTabBar} />;
  };

  const userRole = useSelector((s: AppRootState) => s.user.user?.role);
  const userLoading = useSelector((s: AppRootState) => s.user.loading);

  if (userLoading || !userRole) {
    return null;
  }

  const visibleTabs = ALL_TABS.filter(tab => tab.roles.includes(userRole));
  const initial = visibleTabs[0]?.name ?? SCREEN_NAMES.SEARCH;

  return (
    <View style={styles.container}>
      <Tab.Navigator
        key={`tabs_${userRole}`}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    height: 60,
    borderRadius: 40,
    marginHorizontal: 40,
    marginBottom: 30,
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
  tabItem: {
    flex: 1,
    height: '100%',
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
