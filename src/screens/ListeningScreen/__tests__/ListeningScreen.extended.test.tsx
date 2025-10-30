import React from 'react';
import {act, render} from '@testing-library/react-native';

import {ListeningScreen} from '../ListeningScreen';

jest.useFakeTimers();

// Keep-awake
jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// Navigation
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({t: (k: string) => k}),
  useAppNavigation: () => ({replace: mockReplace, setOptions: jest.fn(), goBack: mockGoBack, reset: jest.fn()}),
  useHardwareBackPressHandler: () => {},
  useNetworkConnectivity: () => ({isOffline: true}),
  useCounselorChat: () => ({checkCounselorChat: jest.fn()}),
  useLiveAudioStream: () => ({startStreaming: jest.fn(), stopStreaming: jest.fn(), isPermissionGranted: true}),
  useSocketConnection: () => ({emitSocketEvent: jest.fn()}),
  useUser: () => ({userData: {id: 'u1'}}),
  useDebounce: (fn: any) => fn,
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

// Avoid importing full components barrel which pulls in network logger
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

// Services
jest.mock('@/services', () => ({
  __esModule: true,
  useGetNudgeStatusQuery: () => ({data: true}),
}));

jest.mock('@/services/chatApi', () => ({
  __esModule: true,
  useEndCallMutation: () => [jest.fn(), {isSuccess: true, isError: false}],
  useLazyGetCounsellorChatQuery: () => [jest.fn().mockResolvedValue({data: []})],
}));

let mockState: any = {};
jest.mock('@/store/hooks', () => ({
  __esModule: true,
  useAppSelector: (selector: any) => selector(mockState),
  useAppDispatch: () => jest.fn(),
}));

describe('ListeningScreen extended', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockGoBack.mockClear();
    mockState = {
      chat: {currentChat: {chatId: null, provider: undefined, platform: undefined}},
      user: {permissions: []},
    };
  });

  const route = {
    key: 'Listening-key',
    name: 'Listening',
    params: {isMicrophoneMode: true},
  } as any;

  it('shows disconnected when offline + mic mode', () => {
    const {getByText} = render(<ListeningScreen route={route} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    // disconnectedType path renders NetworkDisconnected actions
    expect(getByText('Common.offline.goBack')).toBeTruthy();
  });

  it('navigates on end call success', () => {
    mockState = {
      chat: {currentChat: {chatId: 'c1', provider: undefined, platform: undefined}},
      user: {permissions: []},
    };
    render(<ListeningScreen route={route} />);
    // effect should redirect when isEndCallSuccess true
    expect(mockReplace).toHaveBeenCalled();
  });
});


