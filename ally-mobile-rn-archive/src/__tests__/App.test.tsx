import React from 'react';
import {render} from '@testing-library/react-native';

// Helper to load App with a specific ENV and mocks
const loadAppWithEnv = (environment: 'development' | 'production') => {
  jest.resetModules();

  // Mock ENV
  jest.doMock('@/config/env', () => ({
    __esModule: true,
    env: {ENVIRONMENT: environment},
  }));

  // Mock components used by App
  jest.doMock('@/components', () => {
    const React = require('react');
    const {Text} = require('react-native');
    return {
      __esModule: true,
      ToastProvider: ({children}: any) => <>{children}</>,
      ErrorBoundary: ({children}: any) => <>{children}</>,
      NetworkLogs: () => <Text testID="network-logs">logs</Text>,
    };
  });

  // Mock RootNavigator
  jest.doMock('@/navigation/RootNavigator', () => {
    const React = require('react');
    const {Text} = require('react-native');
    return {
      __esModule: true,
      RootNavigator: () => <Text testID="root-navigator">root</Text>,
    };
  });

  // Mock gesture handler root view and safe area provider
  jest.doMock('react-native-gesture-handler', () => {
    const React = require('react');
    const {View} = require('react-native');
    return {
      __esModule: true,
      GestureHandlerRootView: View,
    };
  });

  jest.doMock('react-native-safe-area-context', () => {
    const React = require('react');
    const {View} = require('react-native');
    return {
      __esModule: true,
      SafeAreaProvider: View,
    };
  });

  // Provide a real Redux store or a simple mock to Provider
  jest.doMock('../store/store', () => ({
    store: {getState: () => ({}), subscribe: () => () => {}, dispatch: () => {}},
  }));

  // Replace react-redux Provider with a pass-through component
  jest.doMock('react-redux', () => ({
    __esModule: true,
    Provider: ({children}: any) => children,
  }));

  let AppComp: any;
  jest.isolateModules(() => {
    AppComp = require('../App').App;
  });
  return AppComp;
};

describe('App', () => {
  it('renders RootNavigator inside providers', () => {
    const AppComp = loadAppWithEnv('development');
    const {getByTestId} = render(<AppComp />);
    expect(getByTestId('root-navigator')).toBeTruthy();
  });

  it('renders NetworkLogs in development', () => {
    const AppComp = loadAppWithEnv('development');
    const {getByTestId} = render(<AppComp />);
    expect(getByTestId('network-logs')).toBeTruthy();
  });

  it('does not render NetworkLogs in production', () => {
    const AppComp = loadAppWithEnv('production');
    const {queryByTestId} = render(<AppComp />);
    expect(queryByTestId('network-logs')).toBeNull();
  });
});


