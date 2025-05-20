import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {StyleSheet, View} from 'react-native';

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

export const BottomTabs = () => {
  const renderTabBarIcon = (route: string, focused: boolean) => {
    const focusedIcons = {
      HomeTab: <HomeActiveIcon />,
      CallLog: <CallLogActiveIcon />,
    };

    const unfocusedIcons = {
      HomeTab: <HomeInactiveIcon />,
      CallLog: <CallLogInactiveIcon />,
    };

    return (
      <View style={styles.iconContainer}>
        {focused && <View style={styles.iconContainerActive} />}
        {focused
          ? focusedIcons[route as keyof typeof focusedIcons]
          : unfocusedIcons[route as keyof typeof unfocusedIcons]}
      </View>
    );
  };

  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarIcon: ({focused}) => renderTabBarIcon(route.name, focused),
      })}>
      {TAB_NAMES.map((name, idx) => (
        <Tab.Screen key={name} name={name} component={TAB_COMPONENTS[idx]} />
      ))}
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.darkBlue2,
    borderTopWidth: 0,
    height: 80,
    paddingBottom: 10,
    paddingTop: 10,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
  },
  iconContainerActive: {
    position: 'absolute',
    top: -1,
    backgroundColor: colors.brightBlue,
    width: 56,
    height: 5,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
});
