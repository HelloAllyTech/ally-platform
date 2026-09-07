// Store mock
jest.mock('@/store/store', () => ({ AppRootState: {} }));
jest.mock('@/store/slices/summarySlice', () => ({
  selectSummaryVisibleFields: (state: any) => state.summary.visibleFields,
  setSummaryVisibleFields: jest.fn(),
}));

// Constants mock
jest.mock('@/constants', () => ({
  START_CALL_PERMISSIONS: ['start:microphone-chat', 'start:cloud-telephony-chat'],
  TAB_PERMISSIONS: [
    'view:call:logs',
    'view:scenario-session',
    'edit:scenario-session',
    'view:reviews',
    'view:analytics-dashboard',
    'view:community-leaderboard',
    'view:reference-document',
    'view:community',
  ],
  MICROPHONE_PERMISSION: 'android.permission.RECORD_AUDIO',
  LogType: { REAL: 'REAL', SIMULATION: 'SIMULATION' },
  SCREEN_NAMES: { LISTENING: 'Listening', CALL_LOG: 'CallLog', SEARCH: 'Search' },
  CHAT_TYPES: { 
    EXOTEL_CONFERENCE_CHAT: 'EXOTEL_CONFERENCE_CHAT', 
    MICROPHONE_CHAT: 'MICROPHONE_CHAT',
    DICTATION_MODE: 'DICTATION_MODE',
  },
  USER_PERMISSIONS: {
    VIEW_CALL_LOGS: 'view:call:logs',
    VIEW_SCENARIO_SESSION: 'view:scenario-session',
    START_MICROPHONE_CHAT: 'start:microphone-chat',
    START_CLOUD_TELEPHONY_CHAT: 'start:cloud-telephony-chat'
  },
}));

// Navigation helpers
jest.mock('@/navigation/TabNavigator', () => ({
  getFirstVisibleTab: jest.fn(() => 'CallLog'),
}));

// Mock react-navigation hooks manually
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn() }),
    useRoute: () => ({ name: 'CallLog' }),
    useFocusEffect: () => {},
  };
});

// Mock hooks
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({ navigate: jest.fn() }),
  useCounselorChat: () => ({ checkCounselorChat: jest.fn().mockResolvedValue({}) }),
  useHardwareBackPressHandler: () => {},
  usePermissionAlert: () => ({ showMicrophoneSettingsAlert: jest.fn() }),
  useTranslate: () => ({ t: (k: string) => k }),
  useUser: () => ({ userData: undefined, checkAuth: jest.fn() }),
  useScribeNoteCreationEnabled: () => ({ data: false }),
}));

import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {CallLogScreen} from '../CallLogScreen';

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
    useToast: () => ({ showToast: jest.fn() }),
  };
});

// Config
jest.mock('@/config/env', () => ({ env: { ALLY_WEB_URL: 'https://example.com' } }));

// Constants (duplicate block removed)
// Hooks (duplicate block removed)

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
  useGetCallTagsQuery: () => ({ data: { data: [], count: 0 } }),
}));
jest.mock('@/services/customFieldsApi', () => ({
  useGetCustomFieldDefinitionsQuery: () => ({ data: [] }),
}));
jest.mock('@/services/simulationsApi', () => ({
  useLazyGetSimulationLogsQuery: () => [jest.fn().mockResolvedValue({ data: { data: [] } }), { isFetching: false }],
}));
jest.mock('@/services/scribeNoteApi', () => ({
  useCreateNoteMutation: () => [jest.fn(), { isLoading: false }],
}));
// Mutable so a test can reproduce the state a 401 burst leaves behind:
// the chat-types request never answered, so `data` is undefined.
const mockGetChatTypes = jest.fn();
let mockChatTypesData: string[] | undefined = ['MIC'];
jest.mock('@/services/settingsApi', () => ({
  useLazyGetVisibleChatTypesQuery: () => [
    mockGetChatTypes,
    { data: mockChatTypesData, isFetching: false },
  ],
  useGetSummaryFieldsQuery: () => ({ data: ['field1'], isLoading: false }),
}));

// Utils (isAppFeatureEnabled removed)
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

// Child components
jest.mock('../components', () => ({
  CallLogHeader: ({ search }: any) => <>{search}</>,
  CallLogItem: () => <></>,
  FeatureNotAvailable: ({ description }: any) => <>{description}</>,
  StartSessionModal: () => <></>,
  CallLogFilterSheet: () => <></>,
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

describe('CallLogScreen', () => {
  it('renders empty state when no logs', () => {
    const {getByText} = render(<CallLogScreen />);
    // Should show "no call logs" key via t()
    expect(getByText('calls.fallback.callEmptyTitle')).toBeTruthy();
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

describe('CallLogScreen start-session button', () => {
  beforeEach(() => {
    mockGetChatTypes.mockClear();
    mockChatTypesData = ['MIC'];
  });

  it('stays pressable and retries when the chat-types request never answered', () => {
    // A rotated access token 401s every settings request at once, which left
    // both start-session flags false. The button rendered (permissions are
    // persisted) but was disabled — visible, blue and completely inert until the
    // app was restarted. That is the "clicking the blue button does nothing"
    // report.
    mockChatTypesData = undefined;

    const {getByTestId} = render(<CallLogScreen />);
    const fab = getByTestId('start-session-fab');

    expect(fab.props.accessibilityState?.disabled).not.toBe(true);

    mockGetChatTypes.mockClear();
    fireEvent.press(fab);

    // The press re-asks rather than doing nothing.
    expect(mockGetChatTypes).toHaveBeenCalled();
  });

  it('is disabled only when we actually know no session type is on offer', () => {
    mockChatTypesData = [];

    const {getByTestId} = render(<CallLogScreen />);
    expect(
      getByTestId('start-session-fab').props.accessibilityState?.disabled,
    ).toBe(true);
  });
});
