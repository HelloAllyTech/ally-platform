import {useState} from 'react';
import {createDrawerNavigator} from '@react-navigation/drawer';

import {LogoutModal} from '@/screens/LogoutScreen/components/LogoutModal';
import {colors} from '@/theme/colors';

import {DrawerContent} from '../screens/LogoutScreen/CustomDrawerContent';
import {BottomTabs} from './tabNavigator';

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
          drawerStyle: {
            backgroundColor: colors.white,
            width: '75%',
          },
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
