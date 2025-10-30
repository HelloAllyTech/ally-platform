import React from 'react';
import {render, waitFor} from '@testing-library/react-native';

// Note: Do not mock the entire react-native module to avoid TurboModule requirements

jest.mock('@/config/env', () => ({
  env: {
    CLOUD_TELEPHONY_PATH: '/a',
    MICROPHONE_SOCKET_PATH: '/b',
  },
}));

jest.mock('@/services/settingsApi', () => ({
  useLazyGetSummaryFieldsQuery: () => [jest.fn(), {data: ['field1'], isLoading: false}],
}));

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
}));

jest.mock('@/utils/deeplink', () => {
  const actual = jest.requireActual('@/utils/deeplink');
  return {
    ...actual,
    navigateToCallSummaryOrLog: jest.fn(),
  };
});

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({children}: any) => <>{children}</>,
    useNavigationContainerRef: () => ({
      reset: jest.fn(),
      getCurrentRoute: () => ({name: 'Splash'}),
      getRootState: () => ({}),
    }),
  };
});

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({children}: any) => <>{children}</>,
    Screen: ({children, component: Comp}: any) => {
      if (typeof children === 'function') return children();
      if (Comp) return <Comp />;
      return null;
    },
  }),
}));

jest.mock('@/hooks', () => ({
  useUser: () => ({userData: {id: 1}, isAuthenticated: true}),
  useCounselorChat: () => ({checkCounselorChat: jest.fn()}),
  useNavigationAwareCounselorChat: () => undefined,
  useSocketConnection: () => ({}),
}));

jest.mock('@/screens', () => {
  const React = require('react');
  const {Text} = require('react-native');
  const Leaf = () => <Text>Rendered</Text>;
  return {
    ListeningScreen: Leaf,
    CallSummaryScreen: Leaf,
    BreathingScreen: Leaf,
    SimulationsScreen: Leaf,
    SimulationDetailsScreen: Leaf,
    SimulationAssistantScreen: Leaf,
    SimulationFeedbackScreen: Leaf,
    SplashScreen: Leaf,
    SuspendedAccountScreen: Leaf,
  };
});

jest.mock('../DrawerNavigator', () => ({DrawerNavigator: () => null}));

jest.mock('@/constants', () => ({SCREEN_NAMES: {
  SPLASH: 'Splash', LISTENING: 'Listening', CALL_LOG: 'CallLog', CALL_SUMMARY: 'CallSummary', BREATHING: 'Breathing', SIMULATIONS: 'Simulations', SIMULATION_DETAILS: 'SimulationDetails', SIMULATION_ASSISTANT: 'SimulationAssistant', SIMULATION_FEEDBACK: 'SimulationFeedback', SUSPENDED_ACCOUNT: 'Suspended'
}}));

describe('RootNavigator deep link', () => {
  it('renders RootNavigator without crashing', () => {
    const {RootNavigator} = require('../RootNavigator');
    render(<RootNavigator />);
  });
});


