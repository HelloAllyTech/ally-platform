import React from 'react';
import {act, fireEvent, render, waitFor, within} from '@testing-library/react-native';
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
  useLocalParticipant: () => ({
    localParticipant: {
      getTrackPublications: () => [{kind: 'audio'}],
      setMicrophoneEnabled: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    },
  }),
}));

// Mock livekit-client Room and events
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockSetMic = jest.fn().mockResolvedValue(undefined);

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
      ParticipantConnected: 'participantConnected',
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
    useHardwareBackPressHandler: jest.fn(),
    useUser: () => ({
      userData: {
        name: 'Test User',
        email: 'test@example.com',
      },
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
    CollapsibleButtonGroup: ({buttons, testID}: any) =>
      <View testID={testID}>
        {/* Always show buttons in test mode for easier interaction testing */}
        {buttons && buttons.map((button: any) => (
          <TouchableOpacity
            key={button.id}
            accessibilityLabel={button.id}
            disabled={!!button.disabled}
            onPress={button.onPress}
            testID={button.testID}>
            <Text>{button.label}</Text>
          </TouchableOpacity>
        ))}
      </View>,
    IllustratedActionModal: () => null,
    IllustratedModal: (props: any) => (props.visible ? <View testID="illustrated-modal" /> : null),
    EndingSoonModal: (props: any) => (props.visible ? <View testID="ending-soon" /> : null),
    LiveFeedback: ({message}: any) => <Text testID="live-feedback-message">{message}</Text>,
    SessionScoreMeter: ({score}: any) => <Text testID="score">{String(score)}</Text>,
    SimulationTimer: () => <Text testID="timer">timer</Text>,
    __mocks: {mockShowErrorToast},
  };
});

// Mock local components barrel used by the screen (./components)
jest.mock('../components', () => {
  const React = require('react');
  const {View, Text, TouchableOpacity} = require('react-native');
  return {
    __esModule: true,
    AudioWave: () => <View testID="audio-wave" />,
    EndingSoonModal: () => null,
    LiveFeedback: ({message}: any) => <Text>{message}</Text>,
    SessionScoreMeter: ({score}: any) => <Text testID="score">{String(score)}</Text>,
    SessionChecklist: () => <View testID="session-checklist" />,
    SessionProgress: ({stateNames, difficultyLevel, score}: any) => (
      <View
        testID="session-progress"
        data-state-names={JSON.stringify(stateNames)}
        data-difficulty={difficultyLevel}
        data-score={String(score)}
      />
    ),
    SessionInfoTabs: ({reminders, description, hideHeader, activeTab}: any) => (
      <View
        testID="session-info-tabs"
        data-reminders={JSON.stringify(reminders)}
        data-description={description}
        data-hide-header={String(!!hideHeader)}
        data-active-tab={activeTab}
      />
    ),
    SimulationTimer: () => <Text testID="timer">timer</Text>,
    SimulationCountdown: ({step, label}: any) => (
      <View testID="simulation-countdown" data-step={String(step)}>
        <Text>{label}</Text>
      </View>
    ),
    SimulationControls: ({
      isMicEnabled,
      onMicToggle,
      isFocusMode,
      onFocusModeToggle,
      onEndSession,
      isSimulationInProgress,
      showFocusButton = true,
    }: any) => (
      <View testID="simulation-control-buttons">
        <TouchableOpacity
          accessibilityLabel="mic"
          disabled={!isSimulationInProgress}
          onPress={onMicToggle}>
          <Text>{isMicEnabled ? 'unmuted' : 'muted'}</Text>
        </TouchableOpacity>
        {showFocusButton && (
          <TouchableOpacity
            accessibilityLabel="focus"
            disabled={!isSimulationInProgress}
            onPress={onFocusModeToggle}>
            <Text>{isFocusMode ? 'focused' : 'unfocused'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityLabel="end"
          disabled={!isSimulationInProgress}
          onPress={onEndSession}>
          <Text>end</Text>
        </TouchableOpacity>
      </View>
    ),
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
  getTriggerWarningNames: jest.fn((triggerWarnings) => 
    triggerWarnings?.map((tw: any) => tw.name) || []
  ),
  logger: {info: jest.fn(), error: jest.fn()},
  playNotificationSound: jest.fn().mockResolvedValue(undefined),
  parseMaxTimeSec: jest.fn().mockReturnValue(1200),
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
    UserIcon: () => <View testID="user-icon" />,
    InfoBlackCircleIcon: () => <View testID="info-icon" />,
    ChecklistIcon: () => <View testID="checklist-icon" />,
    BulbIcon: () => <View testID="bulb-icon" />,
    NotesIcon: () => <View testID="notes-icon" />,
  };
});

// Mock ParticipantTile
jest.mock('../components/ParticipantTile/ParticipantTile', () => ({
  ParticipantTile: ({name, avatarUrl, topLeftOverlay, compact}: any) => {
    const React = require('react');
    const {View, Text} = require('react-native');
    return (
      <View testID="participant-tile" data-compact={String(!!compact)}>
        <Text testID="participant-name">{name}</Text>
        {avatarUrl && <Text testID="avatar-url">{avatarUrl}</Text>}
        {topLeftOverlay}
      </View>
    );
  },
}));

// Mock ScenarioInfoOverlay
jest.mock('../components/ScenarioInfoOverlay', () => ({
  ScenarioInfoOverlay: require('react').forwardRef(({title}: any, ref: any) => {
    const React = require('react');
    const {View, Text} = require('react-native');
    React.useImperativeHandle(ref, () => ({
      close: jest.fn(),
      isOpen: false,
    }));
    return (
      <View testID="scenario-info-overlay">
        <Text>{title}</Text>
      </View>
    );
  }),
}));

const baseRouteParams = {
  sessionData: {
    id: 'room-1',
    createdAt: new Date().toISOString(),
    accessToken: 'token',
    liveKitServerUrl: 'wss://lk',
  },
  scenario: {title: 'Persona', coverImageUrl: undefined},
};

// Just needs to be > STRICT_MODE_GUARD_MS (100ms) so the deferred connect fires.
const CONNECT_TIMER_ADVANCE_MS = 500;
// Clears the screen's fixed 3-2-1 start countdown (COUNTDOWN_STEPS in
// SimulationAssistantScreen.tsx) so these tests' existing assertions about
// the live call UI aren't blocked behind it.
const COUNTDOWN_ADVANCE_MS = 3000;

const renderWithProviders = async (ui: React.ReactElement) => {
  const result = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 375, height: 812},
        insets: {top: 0, left: 0, right: 0, bottom: 0},
      }}>
      {ui}
    </SafeAreaProvider>,
  );
  // Advance past the connect timer so the room connection is triggered.
  await act(async () => {
    jest.advanceTimersByTime(CONNECT_TIMER_ADVANCE_MS);
  });
  await act(async () => {
    jest.advanceTimersByTime(COUNTDOWN_ADVANCE_MS);
  });
  return result;
};

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

    const {getByLabelText, getByText} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalledWith('wss://lk', 'token'));
    await act(async () => connectedHandlers.forEach(fn => fn()));
    await waitFor(() => expect(mockSetMic).toHaveBeenCalledWith(true));

    fireEvent.press(getByLabelText('mic'));
    await waitFor(() => expect(getByText('muted')).toBeDefined());
  });

  it('handles stop press and navigates to feedback after endScenarioSession', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getByLabelText} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    fireEvent.press(getByLabelText('end'));

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

    (mockOff as jest.Mock).mockImplementation((event: string, cb: any) => {
       if (event === 'connected') {
         const index = connectedHandlers.indexOf(cb);
         if (index > -1) connectedHandlers.splice(index, 1);
       }
       if (event === 'data') {
         const index = dataHandlers.indexOf(cb);
         if (index > -1) dataHandlers.splice(index, 1);
       }
    });

    const {getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    const now = Date.now();
    const makeEvt = (msOffset: number) => ({
      timestamp: new Date(now + msOffset).toISOString(),
      data: {score: 10, message: 'hello'},
    });

    // Get the last registered handler (most recent)
    const dataHandler = dataHandlers[dataHandlers.length - 1];

    // First event accepted
    await act(async () => dataHandler(makeEvt(0)));
    expect(getByTestId('score').props.children).toBe('10');

    // Second event increments score immediately
    await act(async () => dataHandler(makeEvt(1000)));
    expect(getByTestId('score').props.children).toBe('20');

    // Another event increases the score further
    await act(async () => dataHandler(makeEvt(11_000)));
    expect(getByTestId('score').props.children).toBe('30');

    // No auto-hide assertion; screen keeps latest feedback visible
  });

  it('toggles focus mode when focus button is pressed', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getByLabelText} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Focus button should be available
    const focusButton = getByLabelText('focus');
    expect(focusButton).toBeDefined();

    // Press focus button (toggles focus mode on)
    fireEvent.press(focusButton);
    
    // Press again to toggle back off
    fireEvent.press(focusButton);

    // Button should still be pressable after toggling
    expect(focusButton).toBeDefined();
  });

  it('renders participant tiles for remote and local participants', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getAllByTestId, getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Should have 2 participant tiles
    const tiles = getAllByTestId('participant-tile');
    expect(tiles).toHaveLength(2);

    // Should render scenario info overlay for remote participant
    expect(getByTestId('scenario-info-overlay')).toBeDefined();
  });

  it("renders the learner's own tile as a compact PiP self-view nested over the AI tile, not an equal-size tile", async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getAllByTestId, getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    const tiles = getAllByTestId('participant-tile');
    expect(tiles).toHaveLength(2);
    // Exactly one tile (the learner's) is compact; the AI tile is not.
    const compactFlags = tiles.map(tile => tile.props['data-compact']);
    expect(compactFlags.sort()).toEqual(['false', 'true']);

    // The compact (learner) tile renders INSIDE the PiP wrapper, not as a
    // sibling equal-size tile.
    const pip = getByTestId('participant-pip');
    const tileInsidePip = within(pip).getByTestId('participant-tile');
    expect(tileInsidePip.props['data-compact']).toBe('true');
  });

  it('displays scenario title in info overlay', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const customParams = {
      ...baseRouteParams,
      scenario: {title: 'Custom Scenario Title', coverImageUrl: undefined},
    };

    const {getAllByText} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: customParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Should display scenario title in overlay (appears in both tile name and overlay)
    const titles = getAllByText('Custom Scenario Title');
    expect(titles.length).toBeGreaterThan(0);
  });

  it('shows simulation timer when connected', async () => {
    const connectedHandlers: Array<() => void> = [];
    const participantConnectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      if (event === 'participantConnected') participantConnectedHandlers.push(cb);
      return undefined;
    });

    const {getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));
    // Trigger remote participant joining so startTime is set
    await act(async () => participantConnectedHandlers.forEach(fn => fn()));

    // Should show timer when connected and agent has joined
    expect(getByTestId('timer')).toBeDefined();
  });

  it('shows the state-name stepper once connected when the scenario has stateNames', async () => {
    const connectedHandlers: Array<() => void> = [];
    const participantConnectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      if (event === 'participantConnected') participantConnectedHandlers.push(cb);
      return undefined;
    });

    const paramsWithStateNames = {
      ...baseRouteParams,
      scenario: {
        title: 'Persona',
        difficultyLevel: 'EASY',
        stateNames: [
          {name: 'Resistive', stateId: '1'},
          {name: 'Hopeful', stateId: '2'},
        ],
      },
    };

    const {getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: paramsWithStateNames} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));
    await act(async () => participantConnectedHandlers.forEach(fn => fn()));

    const progress = getByTestId('session-progress');
    expect(progress.props['data-state-names']).toBe(
      JSON.stringify([
        {name: 'Resistive', stateId: '1'},
        {name: 'Hopeful', stateId: '2'},
      ]),
    );
    expect(progress.props['data-difficulty']).toBe('EASY');
  });

  it('does not render the state-name stepper when the scenario has no stateNames', async () => {
    const connectedHandlers: Array<() => void> = [];
    const participantConnectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      if (event === 'participantConnected') participantConnectedHandlers.push(cb);
      return undefined;
    });

    const {queryByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));
    await act(async () => participantConnectedHandlers.forEach(fn => fn()));

    expect(queryByTestId('session-progress')).toBeNull();
  });

  it('shows control buttons when simulation is in progress', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Control buttons component should be present when connected
    // Note: buttons are only visible when maximized (default is collapsed)
    expect(getByTestId('simulation-control-buttons')).toBeDefined();
  });

  it('renders SessionChecklist when experienceMode is CHECKLIST', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const checklistParams = {
      ...baseRouteParams,
      scenario: {
        title: 'Checklist Scenario',
        experienceMode: 'CHECKLIST',
        checklistEvents: [{id: '1', text: 'Step 1'}],
        checklistType: 'GUIDED',
      },
    };

    const {getByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: checklistParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Verify SessionChecklist is rendered
    expect(getByTestId('session-checklist')).toBeDefined();
  });

  it('falls back to participant tiles when CHECKLIST mode has no checklist events', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const emptyChecklistParams = {
      ...baseRouteParams,
      scenario: {
        title: 'Checklist Scenario Without Events',
        experienceMode: 'CHECKLIST',
        checklistEvents: [],
        checklistType: 'GUIDED',
      },
    };

    const {getAllByTestId, queryByTestId} = await renderWithProviders(
      <SimulationAssistantScreen
        route={{params: emptyChecklistParams} as any}
      />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Regression: this configuration used to render neither layout (blank
    // screen). It must fall back to the standard tiles without a checklist.
    expect(getAllByTestId('participant-tile')).toHaveLength(2);
    expect(queryByTestId('session-checklist')).toBeNull();
  });

  it('hides the Focus button when experienceMode is NONE', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const noneParams = {
      ...baseRouteParams,
      scenario: {
        title: 'None Scenario',
        experienceMode: 'NONE',
      },
    };

    const {queryByLabelText, getByLabelText} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: noneParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Mic and end remain; focus is hidden
    expect(getByLabelText('mic')).toBeDefined();
    expect(getByLabelText('end')).toBeDefined();
    expect(queryByLabelText('focus')).toBeNull();
  });

  it('renders a Reminders/Description tab bar under the agent tile when the scenario has session info', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const paramsWithReminders = {
      ...baseRouteParams,
      scenario: {
        title: 'Persona',
        reminders: ['Maintain eye contact', 'Ask open-ended questions'],
        description: 'A challenging caller',
      },
    };

    const {getByTestId, getAllByTestId, queryByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: paramsWithReminders} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    expect(getByTestId('simulation-info-tab-bar')).toBeDefined();
    expect(queryByTestId('simulation-info-tab-checklist')).toBeNull();
    expect(getByTestId('simulation-info-tab-reminders')).toBeDefined();
    expect(getByTestId('simulation-info-tab-description')).toBeDefined();

    // The agent tile always renders, regardless of which tab is active — it
    // isn't itself a tab.
    expect(getAllByTestId('participant-tile')).toHaveLength(2);

    // Lands on the Reminders tab by default (no checklist in this scenario).
    expect(getByTestId('session-info-tabs').props['data-reminders']).toBe(
      JSON.stringify(['Maintain eye contact', 'Ask open-ended questions']),
    );
    expect(getByTestId('session-info-tabs').props['data-description']).toBe(
      'A challenging caller',
    );
    expect(getByTestId('session-info-tabs').props['data-hide-header']).toBe('true');
    expect(getByTestId('session-info-tabs').props['data-active-tab']).toBe('reminders');

    // Tapping the Description tab switches instantly — no scroll/swipe required.
    fireEvent.press(getByTestId('simulation-info-tab-description'));
    expect(getByTestId('session-info-tabs').props['data-active-tab']).toBe('description');
  });

  it('includes a Checklist tab alongside Reminders/Description when the scenario has all three', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const paramsWithEverything = {
      ...baseRouteParams,
      scenario: {
        title: 'Persona',
        experienceMode: 'CHECKLIST',
        checklistEvents: [{id: '1', text: 'Step 1'}],
        checklistType: 'GUIDED',
        reminders: ['Maintain eye contact'],
        description: 'A challenging caller',
      },
    };

    const {getByTestId, queryByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: paramsWithEverything} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    // Checklist takes priority as the default tab when present.
    expect(getByTestId('session-checklist')).toBeDefined();
    expect(queryByTestId('session-info-tabs')).toBeNull();

    fireEvent.press(getByTestId('simulation-info-tab-reminders'));
    expect(getByTestId('session-info-tabs').props['data-active-tab']).toBe('reminders');
    expect(queryByTestId('session-checklist')).toBeNull();
  });

  it('does not render the tab bar when the scenario has no checklist, reminders, or description', async () => {
    const connectedHandlers: Array<() => void> = [];
    (mockOn as jest.Mock).mockImplementation((event: string, cb: any) => {
      if (event === 'connected') connectedHandlers.push(cb);
      return undefined;
    });

    const {queryByTestId} = await renderWithProviders(
      <SimulationAssistantScreen route={{params: baseRouteParams} as any} />,
    );

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await act(async () => connectedHandlers.forEach(fn => fn()));

    expect(queryByTestId('simulation-info-tab-bar')).toBeNull();
    expect(queryByTestId('session-info-tabs')).toBeNull();
    expect(queryByTestId('session-checklist')).toBeNull();
  });
});


