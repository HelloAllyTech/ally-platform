import React from 'react';
import {render, act, fireEvent} from '@testing-library/react-native';

import {ListeningScreen} from '../ListeningScreen';
// Constants used in this test will be mocked below

jest.useFakeTimers();

jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

// Keep components barrel from importing network logger
jest.mock('@/components', () => {
  const React = require('react');
  const {Text, TouchableOpacity} = require('react-native');
  return {
    __esModule: true,
    PrivacyTooltip: ({children}: any) => children,
    PrimaryButton: ({label, onPress}: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('react-native-network-logger', () => ({
  __esModule: true,
  default: () => null,
  startNetworkLogging: jest.fn(),
  stopNetworkLogging: jest.fn(),
}));

jest.mock('@/constants', () => ({
  __esModule: true,
  USER_PERMISSIONS: { VIEW_REFERENCE_DOCUMENT: 'VIEW_REFERENCE_DOCUMENT' },
  AllyPlatforms: { WEB: 'WEB', MOBILE: 'MOBILE' },
  SCREEN_NAMES: { LISTENING: 'Listening', CALL_LOG: 'CallLog' },
  AUDIO_INACTIVE_TIMEOUT: 3000,
}));

jest.mock('@/store/store', () => ({
  store: {
    dispatch: jest.fn(),
    getState: jest.fn(() => ({})),
  },
}));

jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({t: (k: string) => k}),
  useAppNavigation: () => ({replace: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), reset: jest.fn()}),
  useHardwareBackPressHandler: () => {},
  useNetworkConnectivity: () => ({isOffline: false}),
  useCounselorChat: () => ({checkCounselorChat: jest.fn()}),
  useDebounce: (fn: any) => fn,
  useLiveAudioStream: () => ({
    startStreaming: jest.fn(),
    stopStreaming: jest.fn(),
    isPermissionGranted: true,
  }),
  useSocketConnection: () => ({
    emitSocketEvent: jest.fn(),
    isConnected: true,
    isConnecting: false,
  }),
  useSearch: () => ({
    searchText: '',
    showSearchResults: false,
    onSearchBlur: jest.fn(),
    focused: false,
    onChangeText: jest.fn(),
    handleSuggestionPress: jest.fn(),
    triggerSearchOnSubmit: jest.fn(),
    filteredSuggestions: [],
    setShowSuggestions: jest.fn(),
    onSearchFocus: jest.fn(),
    setFocused: jest.fn(),
    onPressSuggestion: jest.fn(),
    lastSearchedText: '',
    resources: [],
    tabsMeta: [],
    activeTabIndex: 0,
    handleTabChange: jest.fn(),
    showInitialLoader: false,
    showFooterLoader: false,
    showEmptyState: true,
    selectedCategory: 'All',
    handleEndReached: jest.fn(),
    resetSearch: jest.fn(),
  }),
  useUser: () => ({userData: {id: 1}}),
  useListeningScreen: () => ({
    isWebMicrophoneMode: false,
    isConferenceCall: false,
    callProvider: undefined,
    tooltipContentList: ['tooltip1', 'tooltip2', 'tooltip3', 'tooltip4'],
    tooltipDisplayInsets: {left: 40, right: 40, top: 10, bottom: 10},
    startTime: Date.now(),
  }),
}));

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (sel: any) =>
    sel({
      chat: {currentChat: {chatId: 123, provider: 'MICROPHONE', platform: 'MOBILE'}},
      user: {permissions: ['VIEW_REFERENCE_DOCUMENT']},
    }),
}));

jest.mock('@/services', () => ({
  useGetNudgeStatusQuery: () => ({data: false}),
}));

jest.mock('@/services/chatApi', () => ({
  useEndCallMutation: () => [jest.fn(), {isSuccess: false, isError: false}],
  useLazyGetCounsellorChatQuery: () => [jest.fn(async () => ({data: [{id: 1}]}))],
}));

describe('ListeningScreen controls', () => {
  it('toggles focus mode, pause/resume, and shows mic note in mic mode', () => {
    const route: any = {key: 'x', name: 'Listening', params: {isMicrophoneMode: true}};
    const {getByText, queryByText} = render(<ListeningScreen route={route} />);

    // microphone mode note visible
    expect(getByText('ListeningScreen.microphoneModeNote')).toBeTruthy();

    // Focus button initially shows focused state, toggles to focus on press
    const focusedBtn = getByText('ListeningScreen.focused');
    act(() => {
      fireEvent.press(focusedBtn);
    });
    expect(getByText('ListeningScreen.focus')).toBeTruthy();

    // Pause/resume toggles label
    const pauseBtn = getByText('ListeningScreen.pauseTranscription');
    act(() => {
      fireEvent.press(pauseBtn);
    });
    expect(getByText('ListeningScreen.resumeTranscription')).toBeTruthy();

    // End session button exists
    expect(queryByText('ListeningScreen.endSession')).toBeTruthy();
  });
});


