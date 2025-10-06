import React from 'react';
import {render} from '@testing-library/react-native';

import {RootNavigator} from '../RootNavigator';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({children}: any) => <>{children}</>,
    useNavigationContainerRef: () => ({reset: jest.fn(), getCurrentRoute: () => ({name: 'Splash'})}),
  };
});

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({children}: any) => <>{children}</>,
    Screen: ({children, component: Comp}: any) => {
      if (typeof children === 'function') {
        return children();
      }
      if (Comp) return <Comp />;
      return null;
    },
  }),
}));

jest.mock('@/config/env', () => ({env: {CLOUD_TELEPHONY_PATH: '/a', MICROPHONE_SOCKET_PATH: '/b'}}));

let mockUseUser: any;
let mockUseCounselorChat: any;
let mockUseNavigationAwareCounselorChat: any;
let mockUseSocketConnection: any;
jest.mock('@/hooks', () => ({
  useUser: (...args: any[]) => mockUseUser?.(...args),
  useCounselorChat: (...args: any[]) => mockUseCounselorChat?.(...args),
  useNavigationAwareCounselorChat: (...args: any[]) =>
    mockUseNavigationAwareCounselorChat?.(...args),
  useSocketConnection: (...args: any[]) => mockUseSocketConnection?.(...args),
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
  };
});

jest.mock('../DrawerNavigator', () => ({DrawerNavigator: () => null}));

jest.mock('@/constants', () => ({SCREEN_NAMES: {
  SPLASH: 'Splash', LISTENING: 'Listening', CALL_LOG: 'CallLog', CALL_SUMMARY: 'CallSummary', BREATHING: 'Breathing', SIMULATIONS: 'Simulations', SIMULATION_DETAILS: 'SimulationDetails', SIMULATION_ASSISTANT: 'SimulationAssistant', SIMULATION_FEEDBACK: 'SimulationFeedback'
}}));

describe('RootNavigator smoke', () => {
  it('renders without crashing', () => {
    mockUseUser = () => ({userData: {id: 1, role: 'COUNSELOR'}, isAuthenticated: true});
    mockUseCounselorChat = () => ({checkCounselorChat: jest.fn()});
    mockUseNavigationAwareCounselorChat = () => undefined;
    mockUseSocketConnection = jest.fn();
    const {toJSON} = render(<RootNavigator />);
    expect(toJSON()).toBeTruthy();
    expect(mockUseSocketConnection).toHaveBeenCalledTimes(2);
  });

  it('renders unauthenticated splash-only flow', () => {
    mockUseUser = () => ({userData: null, isAuthenticated: false});
    mockUseCounselorChat = () => ({checkCounselorChat: jest.fn()});
    mockUseNavigationAwareCounselorChat = () => undefined;
    mockUseSocketConnection = jest.fn();
    const {toJSON} = render(<RootNavigator />);
    expect(toJSON()).toBeTruthy();
  });
});
