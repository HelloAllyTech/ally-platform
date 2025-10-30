import React from 'react';
import {render} from '@testing-library/react-native';

import {RootNavigator} from '../RootNavigator';

// Env
jest.mock('@/config/env', () => ({
  env: {
    CLOUD_TELEPHONY_PATH: '/cloud',
    MICROPHONE_SOCKET_PATH: '/mic',
  },
}));

// Settings API
jest.mock('@/services/settingsApi', () => ({
  useLazyGetSummaryFieldsQuery: () => [jest.fn(), {data: ['field1'], isLoading: false}],
}));

// Summary slice selector passthrough
jest.mock('@/store/slices/summarySlice', () => ({
  setSummaryVisibleFields: (p: any) => ({type: 'setSummaryVisibleFields', payload: p}),
  selectSummaryVisibleFields: () => ['field1'],
}));

// Store hooks
jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
}));

// Screens
jest.mock('@/screens', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    SplashScreen: () => React.createElement(Text, null, 'Splash Screen'),
    ListeningScreen: () => React.createElement(Text, null, 'Listening Screen'),
    CallLogScreen: () => React.createElement(Text, null, 'Call Log Screen'),
    CallSummaryScreen: () => React.createElement(Text, null, 'Call Summary Screen'),
    BreathingScreen: () => React.createElement(Text, null, 'Breathing Screen'),
    SimulationsScreen: () => React.createElement(Text, null, 'Simulations Screen'),
    SimulationDetailsScreen: () => React.createElement(Text, null, 'Simulation Details Screen'),
    SimulationAssistantScreen: () => React.createElement(Text, null, 'Simulation Assistant Screen'),
    SimulationFeedbackScreen: () => React.createElement(Text, null, 'Simulation Feedback Screen'),
    SuspendedAccountScreen: () => React.createElement(Text, null, 'Suspended Account Screen'),
  };
});

// Avoid importing real DrawerNavigator (depends on gesture handler)
jest.mock('../DrawerNavigator', () => ({DrawerNavigator: () => null}));

// Mock native stack to a minimal no-op implementation
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => {
    const React = require('react');
    return {
      Navigator: ({children}: any) => <>{children}</>,
      Screen: ({component: Comp, children}: any) => (Comp ? <Comp /> : children),
    };
  },
}));

// Navigation minimal mocks
const mockResetNav = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({children}: any) => <>{children}</>,
    useNavigationContainerRef: () => ({
      reset: mockResetNav,
      getCurrentRoute: () => ({name: 'Splash'}),
      getRootState: () => ({}),
      navigate: jest.fn(),
    }),
    Linking: {
      getInitialURL: jest.fn(async () => null),
      addEventListener: jest.fn((_evt: string, _cb: any) => ({remove: jest.fn()})),
    },
  };
});

// Hooks to toggle auth and capture socket
const mockUseUser = jest.fn();
const mockUseSocketConnection = jest.fn();
let mockUseCounselorChatOptions: any;
jest.mock('@/hooks', () => ({
  __esModule: true,
  useUser: (...args: any[]) => (mockUseUser as any)(...args),
  useCounselorChat: (opts: any) => {
    mockUseCounselorChatOptions = opts;
    return {checkCounselorChat: jest.fn()};
  },
  useNavigationAwareCounselorChat: jest.fn(),
  useSocketConnection: (...args: any[]) => (mockUseSocketConnection as any)(...args),
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('RootNavigator auth flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: mock socket to immediately trigger USER_JOINED callback if present
    mockUseSocketConnection.mockImplementation(({eventCallbacks}: any) => {
      if (eventCallbacks && eventCallbacks.USER_JOINED) {
        try {
          eventCallbacks.USER_JOINED();
        } catch {}
      }
    });
  });

  it('renders unauthenticated stack (Splash + SuspendedAccount available)', () => {
    mockUseUser.mockReturnValue({userData: undefined, isAuthenticated: false});
    const {getByText} = render(<RootNavigator />);
    expect(getByText('Splash Screen')).toBeTruthy();
  });

  it('initializes socket connections and renders when authenticated', () => {
    mockUseUser.mockReturnValue({userData: {id: 1}, isAuthenticated: true});
    render(<RootNavigator />);
    // Two socket connections should be established
    expect(mockUseSocketConnection).toHaveBeenCalledTimes(2);
    // Validate options passed (paths and userId)
    const firstCallArgs = mockUseSocketConnection.mock.calls[0][0];
    const secondCallArgs = mockUseSocketConnection.mock.calls[1][0];
    expect(firstCallArgs.path).toBe('/cloud');
    expect(secondCallArgs.path).toBe('/mic');
    expect(firstCallArgs.userId).toBe(1);
    expect(secondCallArgs.userId).toBe(1);
  });

  it('handles counselor chat callbacks to reset navigation appropriately', () => {
    mockUseUser.mockReturnValue({userData: {id: 42}, isAuthenticated: true});
    render(<RootNavigator />);
    // Active chat should reset to CallLog -> Listening if not already Listening
    mockResetNav.mockClear();
    mockUseCounselorChatOptions.onActiveChatFound();
    expect(mockResetNav).toHaveBeenCalledWith({
      index: 1,
      routes: [{name: 'CallLog'}, {name: 'Listening'}],
    });

    // No active chat while on Splash should reset to CallLog
    mockResetNav.mockClear();
    mockUseCounselorChatOptions.onNoActiveChatFound();
    expect(mockResetNav).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'CallLog'}],
    });
  });
});


