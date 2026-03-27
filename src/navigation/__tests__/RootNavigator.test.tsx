import React from 'react';
import {Linking} from 'react-native';
import {render} from '@testing-library/react-native';

jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
jest.spyOn(Linking, 'addEventListener').mockReturnValue({remove: jest.fn()} as any);

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    NavigationContainer: ({children}: any) => (
      <View testID="nav-container">{children}</View>
    ),
    useNavigationContainerRef: () => ({
      current: null,
      getCurrentRoute: () => ({name: 'Splash'}),
      reset: jest.fn(),
    }),
  };
});

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({children}: any) => {
      const React = require('react');
      const {View} = require('react-native');
      return <View testID="stack-navigator">{children}</View>;
    },
    Screen: ({name}: any) => {
      const React = require('react');
      const {View} = require('react-native');
      return <View testID={`screen-${name}`} />;
    },
  }),
}));

jest.mock('@/config/env', () => ({
  env: {CLOUD_TELEPHONY_PATH: '/ct', MICROPHONE_SOCKET_PATH: '/mic'},
}));

jest.mock('@/constants', () => ({
  SCREEN_NAMES: {
    SPLASH: 'Splash',
    CALL_LOG: 'CallLog',
    LISTENING: 'Listening',
    CALL_SUMMARY: 'CallSummary',
    BREATHING: 'Breathing',
    SIMULATIONS: 'Simulations',
    SIMULATION_DETAILS: 'SimulationDetails',
    SIMULATION_PATH_DETAILS: 'SimulationPathDetails',
    CASE_DETAILS: 'CaseDetails',
    SIMULATION_ASSISTANT: 'SimulationAssistant',
    SIMULATION_FEEDBACK: 'SimulationFeedback',
    ACHIEVEMENTS: 'Achievements',
    PROFILE_SETTINGS: 'ProfileSettings',
    REACTIONS: 'Reactions',
    REVIEW_DETAILS: 'ReviewDetails',
    SCRIBE_REVIEW_DETAILS: 'ScribeReviewDetails',
    SHARE_CALL_LOG: 'ShareCallLog',
    SHARE_SIMULATION: 'ShareSimulation',
    SUSPENDED_ACCOUNT: 'SuspendedAccount',
  },
}));

jest.mock('@/hooks', () => ({
  useCounselorChat: () => ({checkCounselorChat: jest.fn()}),
  useNavigationAwareCounselorChat: jest.fn(),
  useSocketConnection: jest.fn(),
  useUser: () => ({userData: {id: 1}, isAuthenticated: true}),
}));

jest.mock('@/screens', () => {
  const React = require('react');
  const {View} = require('react-native');
  const stub = () => <View />;
  return {
    AchievementsScreen: stub,
    BreathingScreen: stub,
    CallSummaryScreen: stub,
    CaseDetailsScreen: stub,
    ListeningScreen: stub,
    ProfileSettingsScreen: stub,
    ReactionsScreen: stub,
    ReviewDetailsScreen: stub,
    ScribeReviewDetailsScreen: stub,
    ShareCallLogScreen: stub,
    ShareSimulationScreen: stub,
    SimulationAssistantScreen: stub,
    SimulationDetailsScreen: stub,
    SimulationFeedbackScreen: stub,
    SimulationPathDetailsScreen: stub,
    SimulationsScreen: stub,
    SplashScreen: stub,
    SuspendedAccountScreen: stub,
  };
});

jest.mock('@/services/settingsApi', () => ({
  useLazyGetSummaryFieldsQuery: () => [
    jest.fn(),
    {data: [], isLoading: false},
  ],
}));

jest.mock('@/types', () => ({
  SocketEvent: {USER_JOINED: 'user_joined'},
}));

jest.mock('@/utils', () => ({logger: {error: jest.fn()}}));

jest.mock('@/utils/deeplink', () => ({
  getCallIdFromUrl: jest.fn(),
  isSupportedDeepLink: jest.fn(() => false),
  navigateToCallSummaryOrLog: jest.fn(),
}));

jest.mock('../DrawerNavigator', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {DrawerNavigator: () => <View testID="drawer-navigator" />};
});

import {RootNavigator} from '../RootNavigator';

describe('RootNavigator', () => {
  it('renders NavigationContainer with stack navigator', () => {
    const {getByTestId} = render(<RootNavigator />);
    expect(getByTestId('nav-container')).toBeTruthy();
    expect(getByTestId('stack-navigator')).toBeTruthy();
  });

  it('renders authenticated screens when user is authenticated', () => {
    const {getByTestId} = render(<RootNavigator />);
    expect(getByTestId('screen-CallLog')).toBeTruthy();
    expect(getByTestId('screen-Listening')).toBeTruthy();
  });

  it('renders Splash screen', () => {
    const {getByTestId} = render(<RootNavigator />);
    expect(getByTestId('screen-Splash')).toBeTruthy();
  });
});
