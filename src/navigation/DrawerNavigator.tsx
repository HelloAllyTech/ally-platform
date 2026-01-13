import {useState} from 'react';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import {StyleSheet} from 'react-native';

import {SCREEN_NAMES} from '@/constants';
import {DrawerContent} from '@/screens';
import {LogoutModal} from '@/screens/LogoutScreen';
import {colors} from '@/theme';

import {BottomTabs} from './TabNavigator';

const Drawer = createDrawerNavigator();

export const DrawerNavigator = () => {
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);

  const openLogoutModal = () => setIsLogoutModalVisible(true);

  const renderDrawerContent = (props: DrawerContentComponentProps) => (
    <DrawerContent {...props} openLogoutModal={openLogoutModal} />
  );

  return (
    <>
      <Drawer.Navigator
        drawerContent={renderDrawerContent}
        screenOptions={{
          headerShown: false,
          drawerStyle: styles.drawerContent,
          drawerType: 'front',
        }}>
        <Drawer.Screen
          name={SCREEN_NAMES.BOTTOM_TABS}
          children={() => <BottomTabs />}
        />
      </Drawer.Navigator>
      {isLogoutModalVisible && (
        <LogoutModal
          isLogoutModalVisible={isLogoutModalVisible}
          setIsLogoutModalVisible={setIsLogoutModalVisible}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  drawerContent: {
    backgroundColor: colors.white,
    width: '85%',
  },
});
