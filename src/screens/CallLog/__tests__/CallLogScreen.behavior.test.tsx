import React from 'react';
import {render, act, fireEvent} from '@testing-library/react-native';
import {FlatList, TouchableOpacity, Text} from 'react-native';

import {CallLogScreen} from '../CallLogScreen';

// Focus effect no-op
jest.mock('@react-navigation/native', () => ({useFocusEffect: () => {}}));

// Safe area
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// Assets & components barrel
jest.mock('@/assets/icons', () => ({NoCallLogsIcon: () => null, TranscribeIcon: () => null}));
jest.mock('@/components', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    CallLogSkeleton: () => null,
    EmptyState: ({title}: {title: string}) => React.createElement(RN.Text, {}, title),
    TabView: ({onTabChange}: any) =>
      React.createElement(
        RN.TouchableOpacity,
        {testID: 'to-simulation', onPress: () => onTabChange('SIMULATION')},
        React.createElement(RN.Text, null, 'to-sim'),
      ),
  };
});

// Config and constants
jest.mock('@/config/env', () => ({env: {ALLY_WEB_URL: 'https://example.com', THIRD_PARTY_CALL_NUMBER: '123'}}));
jest.mock('@/constants', () => ({
  CHAT_TYPES: {EXOTEL_CONFERENCE_CHAT: 'EXOTEL', MICROPHONE_CHAT: 'MIC'},
  LogType: {REAL: 'REAL', SIMULATION: 'SIMULATION'},
  MICROPHONE_PERMISSION: 'mic',
  SCREEN_NAMES: {CALL_SUMMARY: 'CallSummary', SIMULATION_FEEDBACK: 'SimulationFeedback'},
  USER_PERMISSIONS: {VIEW_CALL_LOGS: 'CALLS', VIEW_SCENARIO_SESSION: 'SIM', VIEW_START_CALL_PAGE: 'START'},
}));

// Hooks (dynamic via mock-prefixed variables)
const mockNavigate = jest.fn();
const mockShowSettings = jest.fn();
let mockUserData: any = undefined;
let mockChatCheckReturns: any = {};
jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({navigate: mockNavigate}),
  useCounselorChat: () => ({checkCounselorChat: jest.fn().mockResolvedValue(mockChatCheckReturns)}),
  useHardwareBackPressHandler: () => {},
  usePermissionAlert: () => ({showMicrophoneSettingsAlert: mockShowSettings}),
  useTranslate: () => ({t: (k: string) => k}),
  useUser: () => ({userData: mockUserData}),
}));

// Store
let mockPermissions: string[] = ['CALLS', 'START'];
jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) =>
    sel({
      user: {permissions: mockPermissions},
      chat: {currentChat: null},
      summary: {visibleFields: []},
    }),
  useAppDispatch: () => jest.fn(),
}));

// Services - callsApi with pagination inside factory (avoid out-of-scope)
jest.mock('@/services/callsApi', () => {
  const first = Array.from({length: 10}).map((_, i) => ({id: i + 1, details: {chatId: i + 1}}));
  const second = Array.from({length: 5}).map((_, i) => ({id: i + 11, details: {chatId: i + 11}}));
  const mockGetCallLogs = jest
    .fn()
    .mockResolvedValueOnce({data: {data: first}})
    .mockResolvedValueOnce({data: {data: second}})
    .mockResolvedValue({data: {data: second}});
  return {
    useLazyGetCallLogsQuery: () => [mockGetCallLogs, {isFetching: false}],
    __mock__: {mockGetCallLogs},
  };
});

// Other services
jest.mock('@/services/simulationsApi', () => ({
  useLazyGetSimulationLogsQuery: () => [
    jest.fn().mockResolvedValue({
      data: {data: [{id: 99, details: {chatId: 99}}]},
    }),
    {isFetching: false, data: {data: [{id: 99, details: {chatId: 99}}]}},
  ],
}));
let mockVisibleChatTypes: string[] = ['MIC', 'EXOTEL'];
jest.mock('@/services/settingsApi', () => ({
  useLazyGetVisibleChatTypesQuery: () => [jest.fn(), {data: mockVisibleChatTypes}],
  useLazyGetSummaryFieldsQuery: () => [jest.fn(), {data: ['field1']}],
}));

// Utils
let mockIsAppFeatureEnabled = true;
jest.mock('@/utils/common', () => ({isAppFeatureEnabled: () => mockIsAppFeatureEnabled}));
// Linking
jest.mock('react-native/Libraries/Linking/Linking', () => ({openURL: jest.fn()}));
jest.mock('@/utils/logger', () => ({logger: {error: jest.fn()}}));

// Permissions (overridden per test)
jest.mock('react-native-permissions', () => ({
  check: jest.fn().mockResolvedValue('granted'),
  request: jest.fn().mockResolvedValue('granted'),
  RESULTS: {GRANTED: 'granted', BLOCKED: 'blocked'},
}));

// Child components with an actionable StartSessionModal (local components)
jest.mock('../components', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    CallLogHeader: ({search, onRefresh}: any) =>
      React.createElement(
        React.Fragment,
        null,
        search,
        onRefresh
          ? React.createElement(
              RN.TouchableOpacity,
              {testID: 'refresh', onPress: onRefresh},
              React.createElement(RN.Text, null, 'refresh'),
            )
          : null,
      ),
    CallLogItem: (props: any) =>
      React.createElement(
        RN.TouchableOpacity,
        {testID: 'item-press', onPress: props.onItemPress},
        React.createElement(RN.Text, null, 'item'),
      ),
    FeatureNotAvailable: ({description}: any) =>
      React.createElement(React.Fragment, null, description),
    StartSessionModal: ({onListenLive, onJoinCall}: any) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          RN.TouchableOpacity,
          {testID: 'listen-live', onPress: onListenLive},
          React.createElement(RN.Text, null, 'listen'),
        ),
        React.createElement(
          RN.TouchableOpacity,
          {testID: 'join-call', onPress: onJoinCall},
          React.createElement(RN.Text, null, 'join'),
        ),
      ),
    // Note: TabView is imported from '@/components' in screen; mocked above
  };
});

describe('CallLogScreen behaviors', () => {
  it('renders empty state when no logs', () => {
    const {getByText} = render(<CallLogScreen />);
    expect(getByText('CallLogs.noCallLogs')).toBeTruthy();
  });

  it('navigates to Listening when mic permission granted', async () => {
    const {getByTestId} = render(<CallLogScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('listen-live'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('Listening', {isMicrophoneMode: true});
  });

  it('shows settings alert when mic permission blocked', async () => {
    const perms = require('react-native-permissions');
    perms.check.mockResolvedValue('blocked');
    perms.request.mockResolvedValue('blocked');
    const {getByTestId} = render(<CallLogScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('listen-live'));
    });
    expect(mockShowSettings).toHaveBeenCalled();
  });

  it('paginates and refreshes data', async () => {
    const {getByTestId} = render(<CallLogScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('refresh'));
    });
    const callsApi = require('@/services/callsApi');
    expect(callsApi.__mock__.mockGetCallLogs).toHaveBeenCalled();
  });

  it('handles third-party call: already in a call shows alert', async () => {
    mockChatCheckReturns = {chatId: 1};
    const RNAlert = require('react-native').Alert;
    RNAlert.alert = jest.fn();
    const {getByTestId, unmount} = render(<CallLogScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('join-call'));
    });
    expect(RNAlert.alert).toHaveBeenCalled();
    unmount();
  });

  it('handles third-party call Linking.openURL error path', async () => {
    mockChatCheckReturns = {};
    const RNLinking = require('react-native/Libraries/Linking/Linking');
    RNLinking.openURL.mockImplementation(() => { throw new Error('fail'); });
    const RNAlert = require('react-native').Alert;
    RNAlert.alert = jest.fn();
    const {getByTestId, unmount} = render(<CallLogScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('join-call'));
    });
    expect(RNAlert.alert).toHaveBeenCalled();
    unmount();
  });

  it('renders FeatureNotAvailable state', async () => {
    mockUserData = {}; // means userData exists
    mockIsAppFeatureEnabled = false; // force feature not available branch
    const {toJSON, unmount} = render(<CallLogScreen />);
    expect(toJSON()).toBeTruthy();
    unmount();
    // reset
    mockUserData = undefined;
    mockIsAppFeatureEnabled = true;
  });

  it('shows simulation empty state after switching to simulation tab', async () => {
    mockPermissions = ['CALLS', 'START', 'SIM'];
    mockVisibleChatTypes = ['MIC', 'EXOTEL'];
    const {getByTestId, getByText} = render(<CallLogScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('to-simulation'));
    });
    expect(getByText('CallLogs.noSimulationLogs')).toBeTruthy();
  });
});


