import React from 'react';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  AnalyticsActiveIcon,
  AnalyticsInactiveIcon,
  CallLogActiveIcon,
  CallLogInactiveIcon,
  CommunityActiveIcon,
  CommunityInactiveIcon,
  HomeActiveIcon,
  HomeInactiveIcon,
  LiveRecordingActiveIcon,
  LiveRecordingInactiveIcon,
} from '@/assets/icons';
import {
  CallLogScreen,
  CommunityScreen,
  HomeScreen,
  LiveRecordingScreen,
  UserAnalyticsScreen,
} from '@/screens';
import {colors} from '@/theme/colors';

const Tab = createBottomTabNavigator();

const TAB_NAMES = [
  'HomeTab',
  'CallLog',
  'UserAnalytics',
  'LiveRecording',
  'Community',
];

const TAB_COMPONENTS = [
  HomeScreen,
  CallLogScreen,
  UserAnalyticsScreen,
  LiveRecordingScreen,
  CommunityScreen,
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
      HomeTab: <HomeActiveIcon width={18} height={18} />,
      CallLog: <CallLogActiveIcon width={18} height={18} />,
      UserAnalytics: <AnalyticsActiveIcon width={18} height={18} />,
      LiveRecording: <LiveRecordingActiveIcon width={18} height={18} />,
      Community: <CommunityActiveIcon width={20} height={20} />,
    };

    const unfocusedIcons = {
      HomeTab: <HomeInactiveIcon width={18} height={18} />,
      CallLog: <CallLogInactiveIcon width={18} height={18} />,
      UserAnalytics: <AnalyticsInactiveIcon width={18} height={18} />,
      LiveRecording: <LiveRecordingInactiveIcon width={18} height={18} />,
      Community: <CommunityInactiveIcon width={20} height={20} />,
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

  return (
    <View style={styles.container}>
      <Tab.Navigator
        tabBar={renderCustomTabBar}
        screenOptions={{
          headerShown: false,
        }}
        initialRouteName="HomeTab">
        {TAB_NAMES.map((name, idx) => (
          <Tab.Screen key={name} name={name} component={TAB_COMPONENTS[idx]} />
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
    marginBottom: 20,
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
