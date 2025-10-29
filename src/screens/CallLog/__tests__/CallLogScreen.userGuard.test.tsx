import React from 'react';
import {render, waitFor, act} from '@testing-library/react-native';

import {CallLogScreen} from '../CallLogScreen';

const mockCheckAuth = jest.fn();

// Navigation focus effect - no-op to avoid async updates during render
const focusEffectCallbacks: Array<() => void | (() => void)> = [];
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    // Capture focus effect to trigger manually in tests
    useFocusEffect: (cb: any) => {
      focusEffectCallbacks.push(cb);
    },
  };
});
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: jest.fn()}),
  useCounselorChat: () => ({checkCounselorChat: jest.fn().mockResolvedValue({})}),
  useHardwareBackPressHandler: () => {},
  usePermissionAlert: () => ({showMicrophoneSettingsAlert: jest.fn()}),
  useTranslate: () => ({t: (k: string) => k}),
  useDrawerNavigation: () => ({openDrawer: jest.fn()}),
  useUser: () => ({userData: undefined, isUserLoading: false, checkAuth: mockCheckAuth}),
}));

// Safe area
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// Assets
jest.mock('@/assets/icons', () => ({
  NoCallLogsIcon: () => null,
  TranscribeIcon: () => null,
  DrawerMenuIcon: () => null,
  ReplayIcon: () => null,
}));

// Mock components barrel
jest.mock('@/components', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    CallLogSkeleton: () => null,
    EmptyState: ({title}: {title: string}) => React.createElement(RN.Text, {}, title),
    TabView: () => null,
  };
});

// Config
jest.mock('@/config/env', () => ({
  env: {ALLY_WEB_URL: 'https://example.com', THIRD_PARTY_CALL_NUMBER: '123'},
}));

// Constants
jest.mock('@/constants', () => ({
  CHAT_TYPES: {EXOTEL_CONFERENCE_CHAT: 'EXOTEL', MICROPHONE_CHAT: 'MIC'},
  LogType: {REAL: 'REAL', SIMULATION: 'SIMULATION'},
  MICROPHONE_PERMISSION: 'mic',
  SCREEN_NAMES: {CALL_SUMMARY: 'CallSummary', SIMULATION_FEEDBACK: 'SimulationFeedback'},
  USER_PERMISSIONS: {
    VIEW_CALL_LOGS: 'CALLS', 
    VIEW_SCENARIO_SESSION: 'SIM', 
    VIEW_START_CALL_PAGE: 'START',
    START_MICROPHONE_CHAT: 'start:microphone-chat',
    START_CLOUD_TELEPHONY_CHAT: 'start:cloud-telephony-chat'
  },
  START_CALL_PERMISSIONS: ['start:microphone-chat', 'start:cloud-telephony-chat'],
}));

// Hooks mock provided above

// Store
jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) =>
    sel({
      user: {permissions: ['start:microphone-chat', 'start:cloud-telephony-chat']},
      chat: {currentChat: null},
      summary: {visibleFields: []},
    }),
  useAppDispatch: () => jest.fn(),
}));

// Services
jest.mock('@/services/callsApi', () => ({
  useLazyGetCallLogsQuery: () => [jest.fn().mockResolvedValue({data: {data: []}}), {isFetching: false}],
}));
jest.mock('@/services/simulationsApi', () => ({
  useLazyGetSimulationLogsQuery: () => [jest.fn().mockResolvedValue({data: {data: []}}), {isFetching: false}],
}));
jest.mock('@/services/settingsApi', () => ({
  useLazyGetVisibleChatTypesQuery: () => [jest.fn(), {data: ['MIC']}],
  useLazyGetSummaryFieldsQuery: () => [jest.fn(), {data: ['field1']}],
}));

// Utils (isAppFeatureEnabled removed)
jest.mock('@/utils/logger', () => ({logger: {error: jest.fn()}}));

// Permissions
jest.mock('react-native-permissions', () => ({
  check: jest.fn().mockResolvedValue('granted'),
  request: jest.fn().mockResolvedValue('granted'),
  RESULTS: {GRANTED: 'granted', BLOCKED: 'blocked'},
  PERMISSIONS: {
    IOS: { MICROPHONE: 'ios.permission.MICROPHONE' },
    ANDROID: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' }
  }
}));

// Linking
jest.mock('react-native/Libraries/Linking/Linking', () => ({openURL: jest.fn()}));

describe('CallLogScreen user guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls checkAuth on mount when user is missing', async () => {
    render(<CallLogScreen />);
    await act(async () => {
      focusEffectCallbacks.forEach(cb => {
        cb?.();
      });
    });
    await waitFor(() => expect(mockCheckAuth).toHaveBeenCalled());
  });
});


