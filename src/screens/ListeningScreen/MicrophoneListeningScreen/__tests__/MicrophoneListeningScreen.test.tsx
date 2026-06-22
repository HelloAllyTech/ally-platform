import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
  useDebounce: (fn: () => void) => fn,
  useHardwareBackPressHandler: jest.fn(),
  useListeningScreen: () => ({
    tooltipContentList: ['item1'],
    tooltipDisplayInsets: {top: 0},
    startTime: Date.now(),
  }),
  useLiveAudioStream: () => ({
    startStreaming: jest.fn(),
    stopStreaming: jest.fn(),
    isPermissionGranted: true,
  }),
  useNetworkConnectivity: () => ({isOffline: false}),
  useSocketConnection: () => ({emitSocketEvent: jest.fn()}),
  useUser: () => ({userData: {id: 'user-1'}}),
}));

jest.mock('@/services', () => ({
  useGetNudgeStatusQuery: () => ({data: null}),
}));

const mockUseListeningCommon = jest.fn();
jest.mock('../../hooks', () => ({
  useListeningCommon: (...args: unknown[]) => mockUseListeningCommon(...args),
}));

jest.mock('react-native-size-matters', () => ({
  ScaledSheet: {create: (s: unknown) => s},
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    LockIcon: () => <View testID="lock-icon" />,
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    PrivacyTooltip: ({children}: {children: React.ReactNode}) => (
      <View testID="privacy-tooltip">{children}</View>
    ),
  };
});

jest.mock('@/config/env', () => ({
  env: {MICROPHONE_SOCKET_PATH: '/mic'},
}));

jest.mock('@/theme', () => {
  const handler: ProxyHandler<any> = {
    get: (_t, prop) => {
      if (prop === '__esModule') return false;
      if (typeof prop === 'symbol') return undefined;
      return new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
    },
  };
  const p = new Proxy({[Symbol.toPrimitive]: () => '#000'}, handler);
  return {__esModule: true, colors: p, globalStyles: p, fontFamily: p, default: p};
});

jest.mock('../../components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    AudioWaveformContainer: () => <View testID="audio-waveform" />,
    CallEndConfirmationModal: () => <View testID="call-end-modal" />,
    ListeningControls: () => <View testID="listening-controls" />,
    NetworkDisconnected: ({onRetry}: {onRetry: () => void}) => (
      <View testID="network-disconnected" />
    ),
    NudgeSection: () => <View testID="nudge-section" />,
    Search: () => <View testID="search" />,
    Timer: () => <View testID="timer" />,
  };
});

jest.mock('../../styles', () => ({styles: {}}));
jest.mock('../../utils', () => ({
  getStartAudioChatPayload: jest.fn(() => ({})),
  NUM_BARS: 10,
  recorderAudioToAmplitudes: () => new Array(10).fill(0),
}));

// Default mock – scribe mode
const mockRouteParams = {params: {mode: 'scribe'}};
jest.mock('@react-navigation/native', () => ({
  useRoute: () => mockRouteParams,
}));

import {MicrophoneListeningScreen} from '../MicrophoneListeningScreen';

const defaultCommon = {
  chatData: null as any,
  isWebMicrophoneMode: false,
  isFocusMode: true,
  currentNudge: null,
  isLoading: false,
  showCallEndConfirmation: false,
  isPrivacyTooltipVisible: false,
  isControlSectionMaximized: false,
  disconnectedType: null,
  setShowCallEndConfirmation: jest.fn(),
  setIsControlSectionMaximized: jest.fn(),
  setDisconnectedType: jest.fn(),
  setCurrentNudge: jest.fn(),
  setIsLoading: jest.fn(),
  handleCallEndRedirection: jest.fn(),
  handleGoBack: jest.fn(),
  handleEndCall: jest.fn(),
  handleNudgeFeedbackSuccess: jest.fn(),
  toggleFocusMode: jest.fn(),
  handleLockIconPress: jest.fn(),
  handlePrivacyTooltipClose: jest.fn(),
  checkCounselorChat: jest.fn(),
  canShowFocusModeButton: true,
  speakerTranscriptions: [],
  myTranscriptions: [],
  setMyTranscriptions: jest.fn(),
  setSpeakerTranscriptions: jest.fn(),
  processTranscription: jest.fn(),
  updateLastTranscription: jest.fn(),
};

describe('MicrophoneListeningScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseListeningCommon.mockReturnValue({...defaultCommon});
    // reset to scribe by default
    mockRouteParams.params = {mode: 'scribe'} as any;
  });

  it('shows loading state when chatData is null', () => {
    const {getByText} = render(<MicrophoneListeningScreen />);
    expect(getByText('listeningScreen.connecting')).toBeTruthy();
  });

  it('shows disconnected view when disconnectedType is set', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      disconnectedType: 'NETWORK',
    });

    const {getByTestId} = render(<MicrophoneListeningScreen />);
    expect(getByTestId('network-disconnected')).toBeTruthy();
  });

  it('renders focus mode layout when chatData is available', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
      isFocusMode: true,
    });

    const {getByTestId} = render(<MicrophoneListeningScreen />);
    expect(getByTestId('listening-controls')).toBeTruthy();
    expect(getByTestId('timer')).toBeTruthy();
  });

  it('renders listening controls when chat data is available', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
    });

    const {getByTestId} = render(<MicrophoneListeningScreen />);
    expect(getByTestId('listening-controls')).toBeTruthy();
  });

  // --- Dictation mode tests ---

  it('hides search panel in dictation mode (non-focus)', () => {
    mockRouteParams.params = {mode: 'dictation'} as any;
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
      isFocusMode: false,
    });

    const {queryByTestId} = render(<MicrophoneListeningScreen />);
    expect(queryByTestId('search')).toBeNull();
  });

  it('shows search panel in scribe mode (non-focus)', () => {
    mockRouteParams.params = {mode: 'scribe'} as any;
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
      isFocusMode: false,
    });

    const {getByTestId} = render(<MicrophoneListeningScreen />);
    expect(getByTestId('search')).toBeTruthy();
  });

  it('renders transcriptions when in non-focus mode', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
      isFocusMode: false,
      myTranscriptions: [
        {
          id: 1,
          message: 'Hello World',
          senderId: 'user-1',
          timestamp: new Date().toISOString(),
          isFinal: true,
        },
      ],
    });

    const {getByText} = render(<MicrophoneListeningScreen />);
    expect(getByText('Hello World')).toBeTruthy();
  });
});
