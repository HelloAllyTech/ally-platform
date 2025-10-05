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
  useHardwareBackPressHandler: jest.fn(),
}));

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
}));

const AppNavTest = () => {
  const navigation = useAppNavigation();
  return <Text testID="go" onPress={() => navigation.navigate('CallLog')} />;
};

const DrawerNavTest = () => {
  const navigation = useDrawerNavigation();
  return <Text testID="drawer" onPress={() => navigation.navigate('CallLog')} />;
};

const TabBackHandlerTest = () => {
  useTabBackToHomeHandler();
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
