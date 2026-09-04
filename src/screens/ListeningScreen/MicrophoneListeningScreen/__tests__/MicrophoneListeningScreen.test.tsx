import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

const mockEmitSocketEvent = jest.fn();
let mockPermissionGranted = true;
let mockPermissionStatus = 'granted';

jest.mock('@/utils/version', () => ({getAppVersion: () => '1.23.19'}));

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
    isPermissionGranted: mockPermissionGranted,
    permissionStatus: mockPermissionStatus,
  }),
  useNetworkConnectivity: () => ({isOffline: false}),
  useSocketConnection: () => ({emitSocketEvent: mockEmitSocketEvent}),
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
const mockRouteParams = {params: {}};
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
    mockPermissionGranted = true;
    mockPermissionStatus = 'granted';
    // reset to scribe by default
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

  it('shows search panel in scribe mode (non-focus)', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
      isFocusMode: false,
    });

    const {getByTestId} = render(<MicrophoneListeningScreen />);
    expect(getByTestId('search')).toBeTruthy();
  });

  describe('getting out of the screen', () => {
    const lastBackPressHandler = () => {
      const {useHardwareBackPressHandler} = require('@/hooks');
      return useHardwareBackPressHandler.mock.calls.at(-1)?.[0];
    };

    it('offers a visible way out while still connecting', () => {
      const common = {...defaultCommon};
      mockUseListeningCommon.mockReturnValue(common);

      const {getByTestId} = render(<MicrophoneListeningScreen />);
      fireEvent.press(getByTestId('connecting-cancel'));

      expect(common.handleGoBack).toHaveBeenCalled();
    });

    it('leaves on back press when no session has started', () => {
      const common = {...defaultCommon};
      mockUseListeningCommon.mockReturnValue(common);

      render(<MicrophoneListeningScreen />);

      expect(lastBackPressHandler()()).toBe(true);
      expect(common.handleGoBack).toHaveBeenCalled();
      expect(common.setShowCallEndConfirmation).not.toHaveBeenCalled();
    });

    it('leaves on back press from the disconnected view', () => {
      const common = {
        ...defaultCommon,
        chatData: {chatId: 'chat-123'},
        disconnectedType: 'MICROPHONE_FAILURE',
      };
      mockUseListeningCommon.mockReturnValue(common);

      render(<MicrophoneListeningScreen />);

      expect(lastBackPressHandler()()).toBe(true);
      expect(common.handleGoBack).toHaveBeenCalled();
    });

    it('confirms before ending a live session on back press', () => {
      const common = {...defaultCommon, chatData: {chatId: 'chat-123'}};
      mockUseListeningCommon.mockReturnValue(common);

      render(<MicrophoneListeningScreen />);

      expect(lastBackPressHandler()()).toBe(true);
      expect(common.setShowCallEndConfirmation).toHaveBeenCalledWith(true);
      expect(common.handleGoBack).not.toHaveBeenCalled();
    });

    it('lets the second back press through once the confirmation is up', () => {
      const common = {
        ...defaultCommon,
        chatData: {chatId: 'chat-123'},
        showCallEndConfirmation: true,
      };
      mockUseListeningCommon.mockReturnValue(common);

      render(<MicrophoneListeningScreen />);

      expect(lastBackPressHandler()()).toBe(false);
    });
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

describe('scribe start diagnostic', () => {
  const diagnosticCalls = () =>
    mockEmitSocketEvent.mock.calls.filter(
      ([event]) => event === 'SCRIBE_START_DIAGNOSTIC',
    );

  // Rendering this screen under fake timers and walking them forward has to be
  // cleaned up precisely, or it takes the whole suite down with it. Every timer
  // here drives a state update, so advancing outside act() leaves React work
  // queued; leaving the screen mounted keeps its effects alive; and handing the
  // process back with fake timers still installed poisons whatever file jest
  // runs next in the same worker. That combination hung the full run for 46
  // minutes while this file on its own passed in under two seconds.
  let unmountScreen: (() => void) | undefined;

  const renderScreen = () => {
    const utils = render(<MicrophoneListeningScreen />);
    unmountScreen = utils.unmount;
    return utils;
  };

  const advance = (ms: number) => {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
  };

  beforeEach(() => {
    // This describe is a sibling of the one above, so its beforeEach does not
    // run here — clear explicitly or calls leak between tests.
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockPermissionGranted = true;
    mockPermissionStatus = 'granted';
    mockUseListeningCommon.mockReturnValue({...defaultCommon});
  });

  afterEach(() => {
    act(() => {
      unmountScreen?.();
    });
    unmountScreen = undefined;
    // Drain anything the unmount scheduled before handing the timers back.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('reports the unmet gates when no session has started', () => {
    mockPermissionGranted = false;
    mockPermissionStatus = 'denied';

    renderScreen();
    advance(5000);

    const [[, payload]] = diagnosticCalls();
    expect(payload).toMatchObject({
      afterMs: 5000,
      appVersion: '1.23.19',
      isPermissionGranted: false,
      permissionStatus: 'denied',
      isMicrophoneModeSessionCreated: false,
      isWebMicrophoneMode: false,
      hasChatId: false,
    });
  });

  it('reports again at 15s for a counsellor who keeps waiting', () => {
    renderScreen();
    advance(15000);

    expect(diagnosticCalls().map(([, p]) => p.afterMs)).toEqual([5000, 15000]);
  });

  it('stays quiet once the session actually starts', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      chatData: {chatId: 'chat-123'},
    });

    renderScreen();
    advance(15000);

    // A working session needs no explanation, and this must never become
    // routine traffic on every recording.
    expect(diagnosticCalls()).toHaveLength(0);
  });

  it('stays quiet in web-microphone mode, which has no recorder to gate', () => {
    mockUseListeningCommon.mockReturnValue({
      ...defaultCommon,
      isWebMicrophoneMode: true,
    });

    renderScreen();
    advance(15000);

    expect(diagnosticCalls()).toHaveLength(0);
  });
});
