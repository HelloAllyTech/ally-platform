import React from 'react';
import {act, render} from '@testing-library/react-native';

import {ListeningScreen} from '../ListeningScreen';

jest.useFakeTimers();

jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

// Avoid importing the components barrel which pulls in network logger native deps
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

// Mock the logger package directly in case it is imported elsewhere
jest.mock('react-native-network-logger', () => ({
  __esModule: true,
  default: () => null,
  startNetworkLogging: jest.fn(),
  stopNetworkLogging: jest.fn(),
}));

// Break circular dependency between api.ts and store.ts by mocking the store
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
  useNetworkConnectivity: () => ({isOffline: true}),
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
  useUser: () => ({userData: {id: 1}}),
}));

jest.mock('@/store/hooks', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: (sel: any) =>
    sel({
      chat: {currentChat: null},
      user: {permissions: ['edit:scenario-session']},
    }),
}));

jest.mock('@/services', () => ({
  useGetNudgeStatusQuery: () => ({data: true}),
}));

jest.mock('@/services/chatApi', () => ({
  useEndCallMutation: () => [jest.fn(), {isSuccess: false, isError: false}],
  useLazyGetCounsellorChatQuery: () => [jest.fn()],
}));

describe('ListeningScreen coverage', () => {
  it('shows disconnected UI when offline + mic mode', () => {
    const route: any = {key: 'x', name: 'Listening', params: {isMicrophoneMode: true}};
    const {getByText} = render(<ListeningScreen route={route} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(getByText('Common.offline.goBack')).toBeTruthy();
  });
});


