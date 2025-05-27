import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  CallLogActiveIcon,
  CallLogInactiveIcon,
  HomeActiveIcon,
  HomeInactiveIcon,
} from '@/assets/icons';
import {CallLogScreen, HomeScreen} from '@/screens';
import {colors} from '@/theme/colors';

const Tab = createBottomTabNavigator();

const TAB_NAMES = ['HomeTab', 'CallLog'];

const TAB_COMPONENTS = [HomeScreen, CallLogScreen];

const CustomTabBar = (props: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();

  const renderTabBarIcon = (route: string, focused: boolean) => {
    const focusedIcons = {
      HomeTab: <HomeActiveIcon width={20} height={20} />,
      CallLog: <CallLogActiveIcon width={20} height={20} />,
    };

    const unfocusedIcons = {
      HomeTab: <HomeInactiveIcon width={20} height={20} />,
      CallLog: <CallLogInactiveIcon width={20} height={20} />,
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

const renderCustomTabBar = (props: BottomTabBarProps) => {
  return <CustomTabBar {...props} />;
};

export const BottomTabs = () => {
  return (
    <View style={styles.container}>
      <Tab.Navigator
        tabBar={renderCustomTabBar}
        screenOptions={{
          headerShown: false,
        }}>
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
  },
  tabItem: {
    flex: 1,
    height: '100%',
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
