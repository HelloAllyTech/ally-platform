import {useState} from 'react';
import {createDrawerNavigator} from '@react-navigation/drawer';
import {StyleSheet} from 'react-native';

import {DrawerContent} from '@/screens';
import {LogoutModal} from '@/screens/LogoutScreen';
import {colors} from '@/theme/colors';

import {BottomTabs} from './TabNavigator';

const Drawer = createDrawerNavigator();

export const DrawerNavigator = ({hideTabBar}: {hideTabBar: boolean}) => {
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);

  const openLogoutModal = () => setIsLogoutModalVisible(true);

  const renderDrawerContent = () => (
    <DrawerContent openLogoutModal={openLogoutModal} />
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
          name="BottomTabs"
          children={() => <BottomTabs hideTabBar={hideTabBar} />}
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
