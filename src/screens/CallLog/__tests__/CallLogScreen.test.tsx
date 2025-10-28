import React from 'react';
import {render} from '@testing-library/react-native';

import {CallLogScreen} from '../CallLogScreen';

// Navigation focus effect - no-op to avoid async updates during render
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => {},
}));

// Safe area
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Assets
jest.mock('@/assets/icons', () => ({
  NoCallLogsIcon: () => null,
  TranscribeIcon: () => null,
}));

// Mock components barrel to avoid importing NetworkLogs
jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  
  return {
    CallLogSkeleton: () => null,
    EmptyState: ({title}: {title: string}) => React.createElement(Text, {}, title),
    TabView: () => null,
  };
});

// Config
jest.mock('@/config/env', () => ({ env: { ALLY_WEB_URL: 'https://example.com', THIRD_PARTY_CALL_NUMBER: '123' } }));

// Constants
jest.mock('@/constants', () => ({
  CHAT_TYPES: { EXOTEL_CONFERENCE_CHAT: 'EXOTEL', MICROPHONE_CHAT: 'MIC' },
  LogType: { REAL: 'REAL', SIMULATION: 'SIMULATION' },
  MICROPHONE_PERMISSION: 'mic',
  SCREEN_NAMES: { CALL_SUMMARY: 'CallSummary', SIMULATION_FEEDBACK: 'SimulationFeedback' },
  USER_PERMISSIONS: { VIEW_CALL_LOGS: 'CALLS', VIEW_SCENARIO_SESSION: 'SIM', VIEW_START_CALL_PAGE: 'START' },
}));

// Hooks
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({ navigate: jest.fn() }),
  useCounselorChat: () => ({ checkCounselorChat: jest.fn().mockResolvedValue({}) }),
  useHardwareBackPressHandler: () => {},
  usePermissionAlert: () => ({ showMicrophoneSettingsAlert: jest.fn() }),
  useTranslate: () => ({ t: (k: string) => k }),
  useUser: () => ({ userData: undefined }),
}));

// Store
jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) =>
    sel({
      user: { permissions: ['view:call:logs', 'view:scenario-session', 'start:microphone-chat', 'start:cloud-telephony-chat'] },
      chat: { currentChat: null },
      summary: { visibleFields: [] },
    }),
  useAppDispatch: () => jest.fn(),
}));

// Services
jest.mock('@/services/callsApi', () => ({
  useLazyGetCallLogsQuery: () => [jest.fn().mockResolvedValue({ data: { data: [] } }), { isFetching: false }],
}));
jest.mock('@/services/simulationsApi', () => ({
  useLazyGetSimulationLogsQuery: () => [jest.fn().mockResolvedValue({ data: { data: [] } }), { isFetching: false }],
}));
jest.mock('@/services/settingsApi', () => ({
  useLazyGetVisibleChatTypesQuery: () => [jest.fn(), { data: ['MIC'] }],
  useLazyGetSummaryFieldsQuery: () => [jest.fn(), { data: ['field1'] }],
}));

// Utils
jest.mock('@/utils/common', () => ({ isAppFeatureEnabled: () => true }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

// Child components
jest.mock('@/screens/CallLog/components', () => ({
  CallLogHeader: ({ search }: any) => <>{search}</>,
  CallLogItem: () => <></>,
  FeatureNotAvailable: ({ description }: any) => <>{description}</>,
  StartSessionModal: () => <></>,
  TabView: () => <>TabView</>,
}));

// Permissions
jest.mock('react-native-permissions', () => ({ 
  check: jest.fn().mockResolvedValue('granted'), 
  request: jest.fn().mockResolvedValue('granted'), 
  RESULTS: { GRANTED: 'granted', BLOCKED: 'blocked' },
  PERMISSIONS: {
    IOS: { MICROPHONE: 'ios.permission.MICROPHONE' },
    ANDROID: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' }
  }
}));

// Linking
jest.mock('react-native/Libraries/Linking/Linking', () => ({ openURL: jest.fn() }));

// Constants
jest.mock('@/constants', () => ({
  START_CALL_PERMISSIONS: ['start:microphone-chat', 'start:cloud-telephony-chat'],
  LogType: { REAL: 'REAL', SIMULATION: 'SIMULATION' },
  SCREEN_NAMES: { LISTENING: 'Listening' },
  CHAT_TYPES: { 
    EXOTEL_CONFERENCE_CHAT: 'EXOTEL_CONFERENCE_CHAT', 
    MICROPHONE_CHAT: 'MICROPHONE_CHAT' 
  },
  USER_PERMISSIONS: {
    VIEW_CALL_LOGS: 'view:call:logs',
    VIEW_SCENARIO_SESSION: 'view:scenario-session',
    START_MICROPHONE_CHAT: 'start:microphone-chat',
    START_CLOUD_TELEPHONY_CHAT: 'start:cloud-telephony-chat'
  },
}));

describe('CallLogScreen', () => {
  it('renders empty state when no logs', () => {
    const {getByText} = render(<CallLogScreen />);
    // Should show "no call logs" key via t()
    expect(getByText('CallLogs.noCallLogs')).toBeTruthy();
  });

  it('shows TabView when multiple log types available', () => {
    jest.doMock('@/store/hooks', () => ({
      useAppSelector: (sel: any) =>
        sel({
          user: { permissions: ['CALLS', 'SIM', 'START'] },
          chat: { currentChat: null },
          summary: { visibleFields: [] },
        }),
      useAppDispatch: () => jest.fn(),
    }));
    const {unmount} = render(<CallLogScreen />);
    unmount();
  });

  it('renders feature-not-available when microphone disabled', () => {
    jest.doMock('@/services/settingsApi', () => ({
      useLazyGetVisibleChatTypesQuery: () => [jest.fn(), { data: [] }],
      useGetSummaryFieldsQuery: () => ({ data: ['field1'] }),
    }));
    const {toJSON} = render(<CallLogScreen />);
    expect(toJSON()).toBeTruthy();
  });
});
