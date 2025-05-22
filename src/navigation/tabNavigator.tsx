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
      HomeTab: <HomeActiveIcon width={18} height={18} />,
      CallLog: <CallLogActiveIcon width={18} height={18} />,
    };

    const unfocusedIcons = {
      HomeTab: <HomeInactiveIcon width={18} height={18} />,
      CallLog: <CallLogInactiveIcon width={18} height={18} />,
    };

    return (
      <View style={styles.iconContainer}>
        {focused
          ? focusedIcons[route as keyof typeof focusedIcons]
          : unfocusedIcons[route as keyof typeof unfocusedIcons]}
      </View>
    );
  };

  return (
    <View style={styles.container}>
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
    borderTopWidth: 0,
    height: 60,
    borderRadius: 40,
    marginTop: 30,
    marginHorizontal: 40,
    marginBottom: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderWidth: 0.5,
    borderColor: colors.lightGray2,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    minWidth: 60,
    width: 60, // TODO: change when new icon is added
    height: 60,
  },
});
