import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {SCREEN_NAMES, FEEDBACK_MIN_DISPLAY_MS} from '../../../constants';

// Keep timers controllable
jest.useFakeTimers();
jest.setTimeout(15000);

// Mocks
jest.mock('@sayem314/react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// Mock AudioSession from @livekit/react-native
jest.mock('@livekit/react-native', () => ({
  __esModule: true,
  AudioSession: {
    startAudioSession: jest.fn().mockResolvedValue(undefined),
    stopAudioSession: jest.fn().mockResolvedValue(undefined),
    selectAudioOutput: jest.fn().mockResolvedValue(undefined),
    configureAudio: jest.fn().mockResolvedValue(undefined),
    setAppleAudioConfiguration: jest.fn().mockResolvedValue(undefined),
  },
  AndroidAudioTypePresets: {
    media: {},
  },
  RoomContext: {Provider: ({children}: any) => children},
  useRemoteParticipants: () => [
    {
      getTrackPublications: () => [{kind: 'audio'}],
      on: jest.fn(),
      off: jest.fn(),
      isSpeaking: false,
    },
  ],
}));

// Mock livekit-client Room and events
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockSetMic = jest.fn();

jest.mock('livekit-client', () => {
  const createRoom = () => {
    const roomObj: any = {
      connect: mockConnect,
      disconnect: mockDisconnect,
      localParticipant: {
        setMicrophoneEnabled: mockSetMic,
      },
    };
    roomObj.on = (event: string, cb: any) => {
      mockOn(event, cb);
      return roomObj;
    };
    roomObj.off = (event: string, cb: any) => {
      mockOff(event, cb);
      return roomObj;
    };
    return roomObj;
  };
  return {
    Room: jest.fn().mockImplementation(() => createRoom()),
    RoomEvent: {
      Connected: 'connected',
      Disconnected: 'disconnected',
      DataReceived: 'data',
    },
    Track: {Kind: {Audio: 'audio'}, Source: {Microphone: 'mic'}},
    ParticipantEvent: {IsSpeakingChanged: 'IsSpeakingChanged'},
  };
});

// Hooks and toasts
jest.mock('@/hooks', () => {
  const mockReplace = jest.fn();
  const mockRefreshCredits = jest.fn();
  return {
    __esModule: true,
    useAppNavigation: () => ({replace: mockReplace}),
    useSimulationCredits: () => ({
      credits: null,
      getCreditsInfo: null,
      refreshCredits: mockRefreshCredits,
    }),
    mockReplace,
    mockRefreshCredits,
  } as any;
});

jest.mock('@/components', () => {
  const React = require('react');
  const {TouchableOpacity, View, Text} = require('react-native');
  const mockShowErrorToast = jest.fn();
  return {
    __esModule: true,
    useErrorToast: () => ({showErrorToast: mockShowErrorToast}),
    // simple stand-ins used by the screen
    AudioWave: () => <View testID="audio-wave" />,
    ControlButtons: ({
      onMicButtonPress,
      onSimulationEndPress,
      isMicDisabled,
      isSimulationEndDisabled,
      isMuted,
    }: any) => (
      <View>
        <TouchableOpacity
          accessibilityLabel="mic"
          disabled={!!isMicDisabled}
          onPress={onMicButtonPress}>
          <Text>{isMuted ? 'muted' : 'unmuted'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stop"
          disabled={!!isSimulationEndDisabled}
          onPress={onSimulationEndPress}>
          <Text>stop</Text>
        </TouchableOpacity>
      </View>
    ),
    IllustratedActionModal: () => null,
    IllustratedModal: (props: any) => (props.visible ? <View testID="illustrated-modal" /> : null),
    EndingSoonModal: (props: any) => (props.visible ? <View testID="ending-soon" /> : null),
    LiveFeedback: ({message}: any) => <Text>{message}</Text>,
    SessionScoreMeter: ({score}: any) => <Text testID="score">{String(score)}</Text>,
    SimulationTimer: () => <Text testID="timer">timer</Text>,
    __mocks: {mockShowErrorToast},
  };
});

// Mock local components barrel used by the screen (./components)
jest.mock('../components', () => {
  const React = require('react');
  const {TouchableOpacity, View, Text} = require('react-native');
  return {
    __esModule: true,
    AudioWave: () => <View testID="audio-wave" />,
    ControlButtons: ({
      onMicButtonPress,
      onSimulationEndPress,
      isMicDisabled,
      isSimulationEndDisabled,
      isMuted,
    }: any) => (
      <View>
        <TouchableOpacity
          accessibilityLabel="mic"
          disabled={!!isMicDisabled}
          onPress={onMicButtonPress}>
          <Text>{isMuted ? 'muted' : 'unmuted'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="stop"
          disabled={!!isSimulationEndDisabled}
          onPress={onSimulationEndPress}>
          <Text>stop</Text>
        </TouchableOpacity>
      </View>
    ),
    EndingSoonModal: () => null,
    LiveFeedback: ({message}: any) => <Text>{message}</Text>,
    SessionScoreMeter: ({score}: any) => <Text testID="score">{String(score)}</Text>,
    SimulationTimer: () => <Text testID="timer">timer</Text>,
  };
});

jest.mock('@/services', () => {
  const endTrigger = jest.fn().mockResolvedValue({error: undefined});
  return {
    __esModule: true,
    useEndScenarioSessionMutation: () => [endTrigger],
    __endTrigger: endTrigger,
  } as any;
});

jest.mock('@/utils', () => ({
  __esModule: true,
  decodeFeedbackPayloadToJson: (payload: any) => payload,
  logger: {info: jest.fn(), error: jest.fn()},
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (k: string) => k}),
}));

jest.mock('@/assets/icons', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    EndSessionIcon: () => <View testID="end-session-icon" />,
  };
});

const baseRouteParams = {
  sessionData: {
    id: 'room-1',
    createdAt: new Date().toISOString(),
    accessToken: 'token',
    liveKitServerUrl: 'wss://lk',
  },
  scenario: {title: 'Persona', coverImageUrl: undefined},
};

const renderWithProviders = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 375, height: 812},
        insets: {top: 0, left: 0, right: 0, bottom: 0},
      }}>
      {ui}
    </SafeAreaProvider>,
  );

describe('SimulationAssistantScreen', () => {
  const {SimulationAssistantScreen} = require('../SimulationAssistantScreen');
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('connects on mount and toggles mic via control buttons', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getByLabelText, getByText} = renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalledWith('wss://lk', 'token'));
    await act(async () => connectedHandlers.forEach(fn => fn()));
    await waitFor(() => expect(mockSetMic).toHaveBeenCalledWith(true));

    fireEvent.press(getByLabelText('mic'));
    expect(mockSetMic).toHaveBeenCalledWith(false);
  });

  it('handles stop press and navigates to feedback after endScenarioSession', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getByLabelText} = renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    fireEvent.press(getByLabelText('stop'));

    const {mockReplace} = require('@/hooks');
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });

  it('accumulates feedback events', async () => {
    const connectedHandlers: Array<() => void> = [];
    const dataHandlers: Array<(p: any) => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      if (event === 'data') dataHandlers.push(cb);
      return undefined;
    });

    const {getByTestId} = renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    const now = Date.now();
    const makeEvt = (msOffset: number) => ({
      timestamp: new Date(now + msOffset).toISOString(),
      data: {score: 10, message: 'hello'},
    });

    // First event accepted
    await act(async () => dataHandlers.forEach(fn => fn(makeEvt(0))));
    expect(getByTestId('score').props.children).toBe('10');

    // Second event increments score immediately
    await act(async () => dataHandlers.forEach(fn => fn(makeEvt(1000))));
    expect(getByTestId('score').props.children).toBe('20');

    // Another event increases the score further
    await act(async () => dataHandlers.forEach(fn => fn(makeEvt(11_000))));
    expect(getByTestId('score').props.children).toBe('30');

    // No auto-hide assertion; screen keeps latest feedback visible
  });
});


