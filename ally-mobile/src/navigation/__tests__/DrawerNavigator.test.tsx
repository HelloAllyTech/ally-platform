import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {DrawerNavigator} from '../DrawerNavigator';
import {SCREEN_NAMES} from '../../constants';

// Mock Drawer Navigator
jest.mock('@react-navigation/drawer', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    createDrawerNavigator: () => {
      const Navigator = ({children, drawerContent}: any) => (
        <>
          <View testID="drawer-navigator" />
          {drawerContent ? drawerContent({} as any) : null}
          {children}
        </>
      );
      const Screen = ({name, children}: any) => (
        <View>
          <View testID={`drawer-screen-${name}`} />
          {typeof children === 'function' ? children({}) : children}
        </View>
      );
      return {Navigator, Screen};
    },
  };
});

// Mock DrawerContent to expose a way to open the logout modal
jest.mock('@/screens', () => {
  const React = require('react');
  const {View, Button} = require('react-native');
  return {
    __esModule: true,
    DrawerContent: ({openLogoutModal}: {openLogoutModal: () => void}) => (
      <View testID="drawer-content">
        <Button testID="open-logout" title="Open Logout" onPress={openLogoutModal} />
      </View>
    ),
  };
});

// Mock LogoutModal to render a visible marker when shown
jest.mock('@/screens/LogoutScreen', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    LogoutModal: ({isLogoutModalVisible}: {isLogoutModalVisible: boolean}) =>
      isLogoutModalVisible ? <View testID="logout-modal" /> : null,
  };
});

// Mock BottomTabs
jest.mock('@/navigation/TabNavigator', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    BottomTabs: () => <View testID="bottom-tabs" />,
  };
});

describe('DrawerNavigator', () => {
  it('renders drawer content and bottom tabs', () => {
    const {getByTestId} = render(<DrawerNavigator />);

    expect(getByTestId('drawer-navigator')).toBeTruthy();
    expect(getByTestId('drawer-content')).toBeTruthy();
    // Screen name uses constant value
    expect(getByTestId(`drawer-screen-${SCREEN_NAMES.BOTTOM_TABS}`)).toBeTruthy();
    expect(getByTestId('bottom-tabs')).toBeTruthy();
  });

  it('shows LogoutModal when openLogoutModal is called from DrawerContent', () => {
    const {getByTestId, queryByTestId} = render(<DrawerNavigator />);

    expect(queryByTestId('logout-modal')).toBeNull();

    fireEvent.press(getByTestId('open-logout'));

    expect(getByTestId('logout-modal')).toBeTruthy();
  });
});


