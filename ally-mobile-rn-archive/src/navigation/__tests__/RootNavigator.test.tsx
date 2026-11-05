import React from 'react';
import {Linking} from 'react-native';
import {render} from '@testing-library/react-native';

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(),
    requestPermission: jest.fn(),
    createTriggerNotification: jest.fn(),
    cancelTriggerNotification: jest.fn(),
    onForegroundEvent: jest.fn(() => jest.fn()),
    onBackgroundEvent: jest.fn(),
    getInitialNotification: jest.fn(() => Promise.resolve(null)),
  },
  AndroidImportance: {HIGH: 4},
  EventType: {PRESS: 1, DISMISSED: 2},
  TriggerType: {TIMESTAMP: 0},
  RepeatFrequency: {WEEKLY: 2},
}));

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
    createNavigationContainerRef: () => ({
      current: null,
      isReady: () => false,
      // The pending course-link replay listens for navigation state changes.
      addListener: jest.fn(() => jest.fn()),
      navigate: jest.fn(),
      reset: jest.fn(),
      dispatch: jest.fn(),
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
  env: {
    CLOUD_TELEPHONY_PATH: '/ct',
    MICROPHONE_SOCKET_PATH: '/mic',
    NOTIFICATION_SCHEDULE_DAY: 1,
    NOTIFICATION_SCHEDULE_HOUR: 11,
    NOTIFICATION_SCHEDULE_MINUTE: 0,
  },
}));

jest.mock('@/constants', () => ({
  LEADERBOARD_NOTIFICATION_ID: 'weekly-leaderboard',
  LEADERBOARD_CHANNEL_ID: 'leaderboard',
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

jest.mock('react-redux', () => ({
  useSelector: jest.fn(() => ['VIEW_SCENARIO_SESSION']),
  useDispatch: jest.fn(() => jest.fn()),
  useStore: jest.fn(),
}));

const mockUseSocketConnection = jest.fn();

jest.mock('@/hooks', () => ({
  useCounselorChat: () => ({checkCounselorChat: jest.fn()}),
  useNavigationAwareCounselorChat: jest.fn(),
  useSocketConnection: (...args: unknown[]) => mockUseSocketConnection(...args),
  useUser: () => ({userData: {id: 1}, isAuthenticated: true}),
  useLeaderboardNotification: () => ({
    leaderboardNotifEnabled: false,
    handleLeaderboardNotifToggle: jest.fn(),
  }),
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

// Avoids pulling in the real `@/services/api` (and, via it, `@/store/store`)
// from this unrelated navigation test — same reason `settingsApi` above is
// mocked rather than left real.
jest.mock('@/services/pushNotificationService', () => ({
  createRemindersChannel: jest.fn(),
  registerDeviceForPush: jest.fn().mockResolvedValue(null),
  subscribeToForegroundMessages: jest.fn(() => jest.fn()),
  subscribeToTokenRefresh: jest.fn(() => jest.fn()),
}));

// RootNavigator now imports the real `store` value (not just the
// `AppRootState` type) to pass `store.dispatch` into the (mocked, above)
// push-registration calls — that's the only use, so a bare dispatch stub is
// enough. Loading the real store would pull in `@/services/api`, which needs
// far more of `@/constants` than this test's mock above provides.
jest.mock('@/store/store', () => ({
  store: {dispatch: jest.fn()},
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

  it('does not open an app-wide socket on the microphone namespace', () => {
    render(<RootNavigator />);
    const microphoneConnections = mockUseSocketConnection.mock.calls.filter(
      ([options]) => options?.path === '/mic',
    );
    expect(microphoneConnections).toHaveLength(0);
  });
});
