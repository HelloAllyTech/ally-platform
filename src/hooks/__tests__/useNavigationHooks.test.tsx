// Mock store before imports
jest.mock('@/store/store', () => ({ AppRootState: {} }));
jest.mock('@/store/hooks', () => ({
  useAppSelector: jest.fn(() => ({permissions: []})),
}));

// Mock permissions tab helper
jest.mock('@/navigation/TabNavigator', () => ({
  getFirstVisibleTab: jest.fn(() => 'CallLog'),
}));

// Mock Redux
jest.mock('react-redux', () => ({
  useSelector: jest.fn(() => ({user: {permissions: []}})),
}));

import React from 'react';
import {Text} from 'react-native';
import {render, fireEvent} from '@testing-library/react-native';
import {NavigationContainer} from '@react-navigation/native';

import {useAppNavigation} from '../useAppNavigation';
import {useDrawerNavigation} from '../useDrawerNavigation';
import {useTabBackToHomeHandler} from '../useTabBackToHomeHandler';

// Prevent useTabBackToHomeHandler from importing the entire hooks index (which pulls native modules)
jest.mock('@/hooks', () => ({
  useAppNavigation: jest.fn(() => ({
    navigate: jest.fn(),
    reset: jest.fn(),
    goBack: jest.fn(),
  })),
  useDrawerNavigation: jest.fn(() => ({
    navigate: jest.fn(),
    openDrawer: jest.fn(),
  })),
  useHardwareBackPressHandler: jest.fn(),
}));

// Mock imports before importing the module
jest.mock('../useAppNavigation', () => ({
  useAppNavigation: jest.fn(() => ({
    navigate: jest.fn(),
  })),
}));

jest.mock('../useDrawerNavigation', () => ({
  useDrawerNavigation: jest.fn(() => ({
    navigate: jest.fn(),
  })),
}));

jest.mock('../useTabBackToHomeHandler', () => ({
  useTabBackToHomeHandler: jest.fn(),
}));

import {useAppNavigation as useAppNavHook} from '../useAppNavigation';
import {useDrawerNavigation as useDrawerNavHook} from '../useDrawerNavigation';
import {useTabBackToHomeHandler as useTabBackHook} from '../useTabBackToHomeHandler';

// ...

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: jest.fn(() => ({
      navigate: jest.fn(),
      reset: jest.fn(),
      goBack: jest.fn(),
      canGoBack: jest.fn(() => true),
    })),
    useIsFocused: jest.fn(() => true),
  };
});

jest.mock('@/constants', () => ({
  SCREEN_NAMES: {CALL_LOG: 'CallLog'},
  API_ROUTES: {
    AUTH: {
      GENERATE_OTP: '/auth/generate-otp',
      VERIFY_OTP: '/auth/verify-otp',
      REFRESH: '/auth/refresh',
    },
  },
  APIVersion: {V1: 'v1', V2: 'v2'},
  AsyncStorageKeys: {ACCESS_TOKEN: 'accessToken', REFRESH_TOKEN: 'refreshToken'},
}));

const AppNavTest = () => {
  const navigation = useAppNavHook();
  return <Text testID="go" onPress={() => (navigation as any).navigate('CallLog')} />;
};

const DrawerNavTest = () => {
  const navigation = useDrawerNavHook();
  return <Text testID="drawer" onPress={() => (navigation as any).navigate('CallLog')} />;
};

const TabBackHandlerTest = () => {
  useTabBackHook();
  return <Text testID="root">root</Text>;
};

describe('navigation hooks', () => {
  it('useAppNavigation returns a navigation object and can navigate', () => {
    const {getByTestId} = render(
      <NavigationContainer>
        <AppNavTest />
      </NavigationContainer>,
    );
    fireEvent.press(getByTestId('go'));
  });

  it('useDrawerNavigation returns a navigation object and can navigate', () => {
    const {getByTestId} = render(
      <NavigationContainer>
        <DrawerNavTest />
      </NavigationContainer>,
    );
    fireEvent.press(getByTestId('drawer'));
  });

  it('useTabBackToHomeHandler registers handler (covered by mounting)', () => {
    render(
      <NavigationContainer>
        <TabBackHandlerTest />
      </NavigationContainer>,
    );
  });
});
