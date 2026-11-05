import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RoomContext,
  useLocalParticipant,
  useRemoteParticipants,
} from '@livekit/react-native';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import {Room, RoomEvent, Track} from 'livekit-client';
import {useTranslation} from 'react-i18next';
import {Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import SoundPlayer from 'react-native-sound-player';

import {sounds} from '@/assets';
import {
  BulbIcon,
  ChecklistIcon,
  EndSessionIcon,
  NotesIcon,
} from '@/assets/icons';
import {IllustratedModal, useErrorToast} from '@/components';
import {DEFAULT_MAX_TIME_VALUE, SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler, useUser} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useEndScenarioSessionMutation} from '@/services';
import {colors} from '@/theme';
import {
  AgentStatePayload,
  AgentTurnStatus,
  ChecklistType,
  ExperienceMode,
  Feedback,
  LiveEventPayload,
  RoomStatus,
  TurnState,
} from '@/types';
import {
  decodeFeedbackPayloadToJson,
  getTriggerWarningNames,
  // logger,
  parseMaxTimeSec,
  playNotificationSound,
  stringToUint8,
} from '@/utils';

import {
  EndingSoonModal,
  LiveFeedback,
  SessionChecklist,
  SessionGoalTimer,
  SessionInfoTabs,
  SessionProgress,
  SessionScoreMeter,
  SimulationControls,
  SimulationCountdown,
  SimulationTimer,
} from './components';
import {ParticipantTile} from './components/ParticipantTile/ParticipantTile';
import {
  ScenarioInfoOverlay,
  ScenarioInfoOverlayRef,
} from './components/ScenarioInfoOverlay';
import {SessionInfoTab} from './components/SessionInfoTabs/types';
import {styles} from './styles';

// Tiny delay before connect to avoid React effect mount/unmount races. Was
// 5000ms when it was also acting as a "give the agent time to boot" hack;
// agent-readiness is now event-driven below.
const STRICT_MODE_GUARD_MS = 100;
// If the agent participant joins but produces no audio (e.g. user-speaks-first
// scenarios), transition out of ringing after this grace window so the UI
// isn't stuck on ringing forever.
const AGENT_SILENT_GRACE_MS = 1500;

// Visual 3-2-1 countdown shown the moment this screen mounts, synchronized
// with the start-simulation sound (also fired unconditionally on mount,
// below). One second per number, fixed length regardless of how long the
// room actually takes to connect.
const COUNTDOWN_STEPS = [3, 2, 1] as const;
const COUNTDOWN_STEP_MS = 1000;

// Pause/resume control-channel message types (single source to avoid typo
// drift against the agent). Client → agent: PAUSE/RESUME. Agent → client: rest.
const SIM_CONTROL = {
  PAUSE: 'pause',
  RESUME: 'resume',
  PAUSED: 'paused',
  RESUMED: 'resumed',
  CAP_WARNING: 'cap-warning',
  CAP_ENDED: 'cap-ended',
} as const;

// If the agent doesn't ack a pause/resume within this window, assume the
// control packet didn't land and revert the optimistic UI.
const CONTROL_ACK_TIMEOUT_MS = 2500;

type Props = RootStackScreenProps<'SimulationAssistant'>;

export const SimulationAssistantScreen: React.FC<Props> = ({route}) => {
  const {sessionData, scenario, pathId, caseId, languageId} = route.params;
  const isChecklistMode = scenario?.experienceMode === ExperienceMode.CHECKLIST;
  // CHECKLIST-mode scenarios can come back with zero checklist-visible events
  // (backend filters on checklistVisibilityStatus). Fall back to the standard
  // layout in that case — matches web, where tiles always render and only the
  // checklist panel is gated on items.
  const hasChecklist =
    isChecklistMode && (scenario?.checklistEvents?.length ?? 0) > 0;
  const isNoneMode = scenario?.experienceMode === ExperienceMode.NONE;
  const hasReminders = (scenario?.reminders?.length ?? 0) > 0;
  const hasDescription = !!scenario?.description;
  // Checklist/Reminders/Challenge Description all live under one tab bar
  // below the agent tile, rather than the checklist being inlined into the
  // main call view — mirrors web's unified SessionSidebar tabs.
  const hasTabs = hasChecklist || hasReminders || hasDescription;
  const hasStateNames = (scenario?.stateNames?.length ?? 0) > 0;
  const {liveKitServerUrl, accessToken, id: sessionId} = sessionData;
  const [startTime, setStartTime] = useState<Date | null>(null);
  const navigation = useAppNavigation();
  const {t} = useTranslation();
  const [endScenarioSession] = useEndScenarioSessionMutation();
  const {showErrorToast} = useErrorToast();
  const [roomStatus, setRoomStatus] = useState<RoomStatus>(
    RoomStatus.DISCONNECTED,
  );
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [room] = useState<Room>(() => new Room());
  const remoteParticipants = useRemoteParticipants({room});
  const remoteParticipant =
    remoteParticipants.length > 0 ? remoteParticipants[0] : null;
  const {localParticipant} = useLocalParticipant({room});
  const {userData} = useUser();
  const scenarioInfoRef = useRef<ScenarioInfoOverlayRef>(null);

  const remoteAudioPub = remoteParticipant
    ?.getTrackPublications()
    .find(p => p.kind === Track.Kind.Audio);
  const localAudioPub = localParticipant
    .getTrackPublications()
    .find(p => p.kind === Track.Kind.Audio);

  const [feedback, setFeedback] = useState<Feedback>(null);
  const [feedbackKey, setFeedbackKey] = useState<number>(0);
  const [accumulatedScore, setAccumulatedScore] = useState<number>(0);
  const [detectedEvents, setDetectedEvents] = useState<string[]>([]);
  const [agentTurnStatus, setAgentTurnStatus] =
    useState<AgentTurnStatus>('user_turn');
  const agentTurnStatusRef = useRef<AgentTurnStatus>('user_turn');
  const [debouncedRemoteSpeaking, setDebouncedRemoteSpeaking] = useState(false);
  const remoteSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [showEndingSoon, setShowEndingSoon] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  // Which tab of the unified Checklist/Reminders/Description tab bar (below
  // the agent tile) is active — tapping a tab switches instantly (no swipe).
  // The tab bar itself only renders when hasTabs is true (see render below).
  // Reminders/description are static session data (fixed at session start),
  // so a plain lazy initializer — rather than an effect — is enough to land
  // on the first available tab.
  const [activeInfoTab, setActiveInfoTab] = useState<
    'checklist' | SessionInfoTab
  >(() => {
    if (hasChecklist) return 'checklist';
    if (hasReminders) return SessionInfoTab.REMINDERS;
    return SessionInfoTab.DESCRIPTION;
  });
  // Pause/resume: paused time is excluded from the displayed timer and the
  // scenario time limit. `pausedOffsetMs` accumulates completed pauses.
  // NOTE: this is the CLIENT-side clock (drives the scenario time-limit only).
  // Billing/leaderboard paused-time is tracked authoritatively server-side
  // (scenario_sessions.totalPausedMs from the agent's SQS events). The two are
  // intentionally separate — they serve different surfaces.
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [pausedOffsetMs, setPausedOffsetMs] = useState<number>(0);
  const pauseStartedAtRef = useRef<number | null>(null);
  // Tracks an in-flight pause/resume awaiting the agent's ack, with a revert.
  const pendingControlRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    revert: () => void;
  } | null>(null);
  // Mirror current state into refs so the room data handler can reconcile the
  // UI to the agent's authoritative ack without stale closures.
  const isPausedRef = useRef(isPaused);
  const isMicEnabledRef = useRef(isMicEnabled);
  useEffect(() => {
    isPausedRef.current = isPaused;
    isMicEnabledRef.current = isMicEnabled;
  });

  // Tracks whether we've already transitioned to AGENT_JOINED in this session;
  // prevents the grace timer + active-speakers handler from racing.
  const agentJoinedRef = useRef<boolean>(false);
  const silentGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isControlButtonMaximized, setIsControlButtonMaximized] =
    useState<boolean>(false);
  const [showBackPressConfirmation, setShowBackPressConfirmation] =
    useState<boolean>(false);
  const isSimulationInProgress =
    roomStatus === RoomStatus.AGENT_JOINED ||
    roomStatus === RoomStatus.CONNECTED;

  // `null` once the countdown has finished. Runs once on mount, unconditional
  // of connection state — same trigger as the audio cue below — and gates the
  // switch into the live call UI so the learner is never shown it before the
  // countdown completes, even if the room connects/agent joins faster than
  // 3 seconds.
  const [countdownStep, setCountdownStep] = useState<
    (typeof COUNTDOWN_STEPS)[number] | null
  >(COUNTDOWN_STEPS[0]);
  const isCountingDown = countdownStep !== null;

  useEffect(() => {
    const timers = COUNTDOWN_STEPS.slice(1).map((step, index) =>
      setTimeout(() => setCountdownStep(step), (index + 1) * COUNTDOWN_STEP_MS),
    );
    timers.push(
      setTimeout(
        () => setCountdownStep(null),
        COUNTDOWN_STEPS.length * COUNTDOWN_STEP_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const clamp = useCallback((val: number, min: number, max: number) => {
    return Math.min(Math.max(val, min), max);
  }, []);

  const updateAgentTurnStatus = useCallback((status: AgentTurnStatus) => {
    agentTurnStatusRef.current = status;
    setAgentTurnStatus(status);
  }, []);

  // Debounce remote speaking to avoid flicker on natural pauses (matches web: 1500ms)
  useEffect(() => {
    const isRemoteSpeaking = remoteParticipant?.isSpeaking ?? false;
    if (isRemoteSpeaking) {
      setDebouncedRemoteSpeaking(true);
      if (remoteSpeakingTimeoutRef.current) {
        clearTimeout(remoteSpeakingTimeoutRef.current);
        remoteSpeakingTimeoutRef.current = null;
      }
    } else {
      remoteSpeakingTimeoutRef.current = setTimeout(() => {
        setDebouncedRemoteSpeaking(false);
      }, 1500);
    }
    return () => {
      if (remoteSpeakingTimeoutRef.current) {
        clearTimeout(remoteSpeakingTimeoutRef.current);
      }
    };
  }, [remoteParticipant?.isSpeaking]);

  const {remoteTurnState, localTurnState} = useMemo(() => {
    // While paused, both cards show "Paused" — the underlying speaking/thinking/
    // your-turn status is frozen and would otherwise be stale and misleading.
    if (isPaused) {
      return {
        remoteTurnState: TurnState.PAUSED,
        localTurnState: TurnState.PAUSED,
      };
    }

    const isLocalSpeaking = localParticipant?.isSpeaking ?? false;
    const isThinking = agentTurnStatus === 'thinking';

    let remote: TurnState = TurnState.IDLE;
    let local: TurnState = TurnState.IDLE;

    if (isThinking) {
      remote = TurnState.THINKING;
    } else if (debouncedRemoteSpeaking) {
      remote = TurnState.AI_SPEAKING;
      local = TurnState.USER_TURN_TO_LISTEN;
    } else if (isLocalSpeaking) {
      remote = TurnState.AI_LISTENING;
      local = TurnState.IDLE;
    } else {
      remote = TurnState.AI_LISTENING;
      local = TurnState.USER_TURN_TO_SPEAK;
    }

    return {remoteTurnState: remote, localTurnState: local};
  }, [
    isPaused,
    agentTurnStatus,
    debouncedRemoteSpeaking,
    localParticipant?.isSpeaking,
  ]);

  useEffect(() => {
    if (accessToken) {
      setRoomStatus(RoomStatus.CONNECTING);
      // Connect right away; the ringing UI is gated by roomStatus !==
      // AGENT_JOINED and is left in place until the agent emits audio (or the
      // silent-grace fallback fires). The tiny delay is kept solely to dodge
      // React effect mount/unmount races on Hot Reload / StrictMode.
      const connectionTimeout = setTimeout(() => {
        handleConnect();
      }, STRICT_MODE_GUARD_MS);

      return () => {
        clearTimeout(connectionTimeout);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    activateKeepAwake();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  useHardwareBackPressHandler(() => {
    if (isSimulationInProgress) {
      setShowBackPressConfirmation(true);
      return true;
    }
    return false;
  });

  const maxTimeSec = parseMaxTimeSec(scenario?.maxTimeValue);

  // const ensureCorrectAudioOutput = useCallback(async () => {
  //   const attempts = 3;
  //   for (let currAttempt = 0; currAttempt < attempts; currAttempt++) {
  //     try {
  //       await AudioSession.startAudioSession();
  //       const availableOutputs = await AudioSession.getAudioOutputs();
  //       const hasHeadphones = availableOutputs.some(
  //         o => o === 'headset' || o === 'bluetooth',
  //       );
  //       if (!hasHeadphones) {
  //         await AudioSession.selectAudioOutput('speaker');
  //       }
  //       break;
  //     } catch (error) {
  //       logger.error(`Failed to ensure speaker output: ${error}`);
  //     }
  //     await new Promise(res => setTimeout(res, 200));
  //   }
  // }, []);

  const attachRoomListeners = useCallback(() => {
    const transitionToAgentJoined = () => {
      if (agentJoinedRef.current) return;
      agentJoinedRef.current = true;
      if (silentGraceTimerRef.current) {
        clearTimeout(silentGraceTimerRef.current);
        silentGraceTimerRef.current = null;
      }
      // Stop the ringtone once the agent is actually speaking (or grace-timer
      // expired) — matches the event-driven ringing behavior on web.
      try {
        SoundPlayer.stop();
      } catch {
        // Ignore if sound already finished
      }
      setRoomStatus(RoomStatus.AGENT_JOINED);
    };

    const onConnected = async () => {
      setRoomStatus(RoomStatus.CONNECTED);
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
        // await ensureCorrectAudioOutput();
      } catch (error) {
        showErrorToast(error, 'errors.attachListeners');
      }
    };

    const onRemoteParticipantConnected = () => {
      setStartTime(prev => prev ?? new Date());
      // Stay in ringing UI until the agent actually emits audio. For scenarios
      // where the agent waits for the user to speak first, the grace timer
      // below promotes us to AGENT_JOINED so the UI doesn't ring forever.
      if (!agentJoinedRef.current && !silentGraceTimerRef.current) {
        silentGraceTimerRef.current = setTimeout(() => {
          silentGraceTimerRef.current = null;
          transitionToAgentJoined();
        }, AGENT_SILENT_GRACE_MS);
      }
    };

    const onActiveSpeakersChanged = (speakers: unknown) => {
      // The agent (or any non-local participant) emitting audio ends the ring.
      const localIdentity = room.localParticipant?.identity;
      const list = Array.isArray(speakers) ? speakers : [];
      const remoteSpeaking = list.some(
        s => s && (s as {identity?: string}).identity !== localIdentity,
      );
      if (remoteSpeaking) transitionToAgentJoined();
    };

    const onDisconnected = () => {
      if (roomStatus !== RoomStatus.DISCONNECTING) {
        playNotificationSound(sounds.endSimulation);
        setRoomStatus(RoomStatus.DISCONNECTING);
        setIsMicEnabled(false);
        updateAgentTurnStatus('user_turn');
        navigation.replace(SCREEN_NAMES.SIMULATION_FEEDBACK, {
          scenarioSessionId: sessionId,
          pathId,
          caseId,
          ...(languageId && {languageId}),
        });
      }
    };
    const onDataReceived = (payload: unknown) => {
      const eventObj = decodeFeedbackPayloadToJson(payload) as
        | LiveEventPayload
        | AgentStatePayload
        | null;

      if (!eventObj) return;

      // Handle agent state events
      if ((eventObj as AgentStatePayload).type === 'AGENT_STATE') {
        const agentEvent = eventObj as AgentStatePayload;
        if (agentEvent.state === 'thinking') {
          updateAgentTurnStatus('thinking');
        } else if (agentEvent.state === 'done_thinking') {
          if (agentTurnStatusRef.current !== 'speaking') {
            updateAgentTurnStatus('user_turn');
          }
        } else if (agentEvent.state === 'speaking') {
          updateAgentTurnStatus('speaking');
        }
        return;
      }

      // Pause/resume control acks from the agent. 'paused'/'resumed' confirm the
      // optimistic UI; 'cap-warning' warns before auto-end; 'cap-ended' is
      // followed by room teardown (onDisconnected navigates to feedback).
      const ctrlType = (eventObj as {type?: string}).type;
      if (ctrlType === SIM_CONTROL.PAUSED || ctrlType === SIM_CONTROL.RESUMED) {
        // Agent confirmed — cancel the revert timer and treat the ack as
        // AUTHORITATIVE: reconcile the UI to it (self-heals a late ack that
        // fired after the optimistic revert, so client/agent can't diverge).
        if (pendingControlRef.current) {
          clearTimeout(pendingControlRef.current.timer);
          pendingControlRef.current = null;
        }
        const agentPaused = ctrlType === SIM_CONTROL.PAUSED;
        if (agentPaused && !isPausedRef.current) {
          pauseStartedAtRef.current = pauseStartedAtRef.current ?? Date.now();
          setIsPaused(true);
          room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        } else if (!agentPaused && isPausedRef.current) {
          if (pauseStartedAtRef.current !== null) {
            const banked = Date.now() - pauseStartedAtRef.current;
            setPausedOffsetMs(prev => prev + banked);
            pauseStartedAtRef.current = null;
          }
          setIsPaused(false);
          room.localParticipant
            .setMicrophoneEnabled(isMicEnabledRef.current)
            .catch(() => {});
        }
        return;
      }
      if (ctrlType === SIM_CONTROL.CAP_WARNING) {
        setShowEndingSoon(true);
        return;
      }
      if (ctrlType === SIM_CONTROL.CAP_ENDED) {
        return;
      }

      const feedbackEvent = eventObj as LiveEventPayload;
      if (!feedbackEvent?.data) return;

      const {score, emoji, message, detected_event_ids} = feedbackEvent.data;

      if (typeof score === 'number' && !Number.isNaN(score)) {
        setAccumulatedScore(prev => clamp(prev + score, -100, 100));
      }

      if (message && typeof message === 'string') {
        const id = Date.now();
        const next = {id, text: message, emoji: emoji ?? undefined};
        setFeedback(next);
        setFeedbackKey(next.id);
      }

      if (
        detected_event_ids &&
        Array.isArray(detected_event_ids) &&
        detected_event_ids.length > 0
      ) {
        setDetectedEvents(prev => {
          // Merge unique events
          const newEvents = new Set([...prev, ...detected_event_ids]);
          return Array.from(newEvents);
        });
      }
    };
    room
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.ParticipantConnected, onRemoteParticipantConnected)
      .on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged)
      .on(RoomEvent.DataReceived, onDataReceived);
    return () => {
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.ParticipantConnected, onRemoteParticipantConnected)
        .off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged)
        .off(RoomEvent.DataReceived, onDataReceived);
      // Reset ringing/agent-joined tracking so a subsequent attach starts fresh.
      agentJoinedRef.current = false;
      if (silentGraceTimerRef.current) {
        clearTimeout(silentGraceTimerRef.current);
        silentGraceTimerRef.current = null;
      }
    };
  }, [
    room,
    // ensureCorrectAudioOutput,
    showErrorToast,
    roomStatus,
    navigation,
    sessionId,
    pathId,
    caseId,
    languageId,
    clamp,
    updateAgentTurnStatus,
  ]);

  useEffect(() => attachRoomListeners(), [attachRoomListeners]);

  // Clear any pending control-ack timer on unmount.
  useEffect(
    () => () => {
      if (pendingControlRef.current) {
        clearTimeout(pendingControlRef.current.timer);
      }
    },
    [],
  );

  useEffect(() => {
    playNotificationSound(sounds.startSimulation);
  }, []);

  const configureAudioSession = async () => {
    try {
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
          audioTypeOptions: AndroidAudioTypePresets.media,
        },
        ios: {
          defaultOutput: 'speaker',
        },
      });
    } catch (error) {
      showErrorToast(error, 'errors.audioSession');
    }
  };

  const handleConnect = useCallback(async () => {
    try {
      await configureAudioSession();
      await room.connect(liveKitServerUrl, accessToken);
    } catch (error) {
      showErrorToast(error, 'errors.connect');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, liveKitServerUrl]);

  const handleDisconnect = useCallback(async () => {
    try {
      setRoomStatus(RoomStatus.DISCONNECTING);
      playNotificationSound(sounds.endSimulation);
      await room.disconnect();
      await endScenarioSession({
        scenarioSessionId: sessionId,
      });
    } finally {
      navigation.replace(SCREEN_NAMES.SIMULATION_FEEDBACK, {
        scenarioSessionId: sessionId,
        pathId,
        caseId,
        ...(languageId && {languageId}),
      });
      setIsMicEnabled(false);
      setRoomStatus(RoomStatus.DISCONNECTED);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pathId, caseId]);

  const handleToggleMic = useCallback(async () => {
    try {
      const next = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setIsMicEnabled(next);
    } catch (error) {
      showErrorToast(error, 'errors.toggleMic');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicEnabled]);

  const setMic = useCallback(
    async (enabled: boolean) => {
      try {
        await room.localParticipant.setMicrophoneEnabled(enabled);
      } catch {
        /* best-effort */
      }
    },
    [room],
  );

  // Send a control packet to the agent. The agent freezes/unfreezes audio +
  // brain and reports paused time to the backend.
  const publishControl = useCallback(
    async (type: typeof SIM_CONTROL.PAUSE | typeof SIM_CONTROL.RESUME) => {
      try {
        await room.localParticipant.publishData(
          stringToUint8(JSON.stringify({type})),
          {reliable: true},
        );
      } catch (error) {
        showErrorToast(error, 'errors.toggleMic');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Arm a revert timer: if the agent doesn't ack within the window, undo the
  // optimistic UI so the client can't silently diverge from the agent/backend.
  const armControlAck = useCallback((revert: () => void) => {
    if (pendingControlRef.current) {
      clearTimeout(pendingControlRef.current.timer);
    }
    const timer = setTimeout(() => {
      pendingControlRef.current = null;
      revert();
      showErrorToast(undefined, 'errors.pauseControl');
    }, CONTROL_ACK_TIMEOUT_MS);
    pendingControlRef.current = {timer, revert};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTogglePause = useCallback(async () => {
    if (!isPaused) {
      // Pause: stop publishing the mic (genuinely not recorded — no glow, no
      // audio leaves the device), freeze the clock locally (drives the scenario
      // time-limit), and signal the agent.
      const revert = () => {
        pauseStartedAtRef.current = null;
        setIsPaused(false);
        setMic(isMicEnabled);
      };
      await setMic(false);
      pauseStartedAtRef.current = Date.now();
      setIsPaused(true);
      await publishControl(SIM_CONTROL.PAUSE);
      armControlAck(revert);
    } else {
      // Resume: restore the mic to its pre-pause state, bank the paused
      // interval, then signal the agent.
      const pausedAt = pauseStartedAtRef.current;
      const prevOffset = pausedOffsetMs;
      const revert = () => {
        setPausedOffsetMs(prevOffset);
        pauseStartedAtRef.current = pausedAt ?? Date.now();
        setIsPaused(true);
        setMic(false);
      };
      await setMic(isMicEnabled);
      if (pausedAt !== null) {
        setPausedOffsetMs(prev => prev + (Date.now() - pausedAt));
        pauseStartedAtRef.current = null;
      }
      setIsPaused(false);
      setShowEndingSoon(false);
      await publishControl(SIM_CONTROL.RESUME);
      armControlAck(revert);
    }
  }, [
    isPaused,
    isMicEnabled,
    pausedOffsetMs,
    setMic,
    publishControl,
    armControlAck,
  ]);

  const renderLoader = () => {
    const getLoadingText = () => {
      if (
        roomStatus === RoomStatus.CONNECTED ||
        roomStatus === RoomStatus.CONNECTING
      ) {
        return t('simulationPage.waitingForAgent');
      }
      if (roomStatus === RoomStatus.DISCONNECTING) {
        return t('simulationPage.endSession');
      }
      return t('simulationPage.connectingToSession');
    };

    return (
      <View style={styles.loadingWrapper}>
        <Text style={styles.loadingTitle}>
          <Text style={styles.loadingItalic}>{getLoadingText()}</Text>
        </Text>
        {roomStatus === RoomStatus.CONNECTING && (
          <Text style={styles.loadingDescription}>
            {t('simulationPage.microphonePrompt')}
          </Text>
        )}
      </View>
    );
  };

  // The agent tile always renders during a live session — checklist/reminders/
  // description now live in the unified tab bar below it (see infoTabs),
  // rather than the checklist being inlined here as it was previously.
  const renderParticipants = () => (
    <View
      style={[
        styles.participantsContent,
        !hasTabs && styles.participantsContentFull,
      ]}>
      <View
        style={[
          styles.participantsContainer,
          hasTabs
            ? [styles.participantsHorizontal, styles.participantsCompact]
            : isFocusMode
              ? styles.participantsVertical
              : isControlButtonMaximized
                ? feedback
                  ? styles.participantsHorizontal
                  : styles.participantsVertical
                : styles.participantsVertical,
        ]}>
        <View
          style={[
            styles.participantWrapper,
            styles.participantWrapperWithOverlay,
          ]}>
          <ParticipantTile
            participant={remoteParticipant}
            publication={remoteAudioPub}
            avatarUrl={scenario?.coverImageUrl ?? null}
            name={scenario?.metadata?.name || scenario?.title}
            turnState={remoteTurnState}
            {...(scenario?.title
              ? {
                  topLeftOverlay: (
                    <ScenarioInfoOverlay
                      ref={scenarioInfoRef}
                      title={scenario?.title}
                      triggerWarnings={getTriggerWarningNames(
                        scenario?.triggerWarnings,
                      )}
                    />
                  ),
                  overlayRef:
                    scenarioInfoRef as React.RefObject<ScenarioInfoOverlayRef>,
                }
              : {})}
          />
          {/* Learner's own self-view: a small inlaid picture-in-picture
              bubble over the AI tile, like a WhatsApp video call,
              rather than an equal-size tile of its own. */}
          <View style={styles.pipWrapper} testID="participant-pip">
            <ParticipantTile
              participant={localParticipant}
              publication={localAudioPub}
              avatarUrl={userData?.profileImageUrl ?? null}
              name={userData?.name}
              isMicEnabled={isMicEnabled}
              turnState={localTurnState}
              compact
            />
          </View>
        </View>
      </View>
      {/* Checklist mode already surfaces real-time progress via its own tab,
          so the generic nudge overlay is redundant there — same behavior as
          before this became a tab. */}
      {!hasChecklist && !isFocusMode && feedback && (
        <View style={styles.liveFeedbackWrapper}>
          <LiveFeedback
            key={feedbackKey}
            message={feedback.text}
            emoji={feedback.emoji}
          />
        </View>
      )}
    </View>
  );

  // Unified Checklist/Reminders/Description tab bar below the agent tile —
  // tapping a tab switches instantly (no swipe needed), matching the flat
  // tab structure used on web's SessionSidebar. Each tab only appears when
  // the scenario actually has that content.
  const infoTabs: {
    id: 'checklist' | SessionInfoTab;
    label: string;
    Icon: typeof ChecklistIcon;
  }[] = [
    ...(hasChecklist
      ? [
          {
            id: 'checklist' as const,
            label: t('simulationPage.checklistTab'),
            Icon: ChecklistIcon,
          },
        ]
      : []),
    ...(hasReminders
      ? [
          {
            id: SessionInfoTab.REMINDERS,
            label: t('simulationPage.remindersTab'),
            Icon: BulbIcon,
          } as const,
        ]
      : []),
    ...(hasDescription
      ? [
          {
            id: SessionInfoTab.DESCRIPTION,
            label: t('simulationPage.descriptionTab'),
            Icon: NotesIcon,
          } as const,
        ]
      : []),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <RoomContext.Provider value={room}>
        <View style={styles.contentContainer}>
          {isSimulationInProgress && startTime && (
            <SimulationTimer
              startTime={startTime}
              timeLimit={maxTimeSec}
              onWarning={() => setShowEndingSoon(true)}
              onTimeLimit={handleDisconnect}
              isPaused={isPaused}
              pausedOffsetMs={pausedOffsetMs}
            />
          )}

          {isSimulationInProgress && startTime && scenario?.timerMode && (
            <SessionGoalTimer
              startTime={startTime}
              maxTimeValue={
                scenario?.maxTimeValue
                  ? scenario?.maxTimeValue
                  : DEFAULT_MAX_TIME_VALUE
              }
              isPaused={isPaused}
              pausedOffsetMs={pausedOffsetMs}
            />
          )}
          {/* Always visible regardless of which tab is active — same
              placement/behavior as web's SessionSidebar stepper strip. */}
          {isSimulationInProgress && hasStateNames && (
            <View style={styles.stateProgressWrapper}>
              <SessionProgress
                stateNames={scenario?.stateNames ?? []}
                difficultyLevel={scenario?.difficultyLevel ?? ''}
                score={accumulatedScore}
              />
            </View>
          )}
          {!isSimulationInProgress || isCountingDown
            ? renderLoader()
            : renderParticipants()}
          {hasTabs && (
            <View style={styles.infoTabBar} testID="simulation-info-tab-bar">
              {infoTabs.map(tab => {
                const isActive = activeInfoTab === tab.id;
                const {Icon} = tab;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    activeOpacity={0.7}
                    testID={`simulation-info-tab-${tab.id}`}
                    onPress={() => setActiveInfoTab(tab.id)}
                    style={styles.infoTabButton}>
                    <Icon
                      width={16}
                      height={16}
                      color={isActive ? 'white' : '#9CA3AF'}
                    />
                    <Text
                      style={[
                        styles.infoTabLabel,
                        isActive && styles.infoTabLabelActive,
                      ]}>
                      {tab.label}
                    </Text>
                    {isActive && <View style={styles.infoTabIndicator} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {hasTabs && (
            <View style={styles.pagerPage}>
              {activeInfoTab === 'checklist' ? (
                <SessionChecklist
                  mode={scenario?.checklistType ?? ChecklistType.OFF}
                  items={scenario?.checklistEvents ?? []}
                  triggeredEvents={detectedEvents}
                  hideHeader
                />
              ) : (
                <SessionInfoTabs
                  reminders={scenario?.reminders}
                  description={scenario?.description}
                  hideHeader
                  activeTab={activeInfoTab}
                  onTabChange={setActiveInfoTab}
                />
              )}
            </View>
          )}

          {isSimulationInProgress && scenario?.showScoreMeter !== false && (
            <View style={styles.scoreMeterContainer}>
              <SessionScoreMeter score={accumulatedScore} />
            </View>
          )}

          <EndingSoonModal
            visible={showEndingSoon && isSimulationInProgress}
            titleMain={t('simulationPage.warningDialog.titleNormal')}
            titleItalic={t('simulationPage.warningDialog.titleItalic')}
            description={t('simulationPage.warningDialog.content')}
            onContinue={() => setShowEndingSoon(false)}
            onEndSession={handleDisconnect}
          />

          <IllustratedModal
            visible={showBackPressConfirmation}
            onClose={() => setShowBackPressConfirmation(false)}
            description={t('simulationPage.endDialog.content')}
            actionButtonText={t('simulationPage.endSession')}
            titleMain={t('listeningScreen.end')}
            titleItalic={t('common.simulation')}
            onActionPress={handleDisconnect}
            actionButtonColor={colors.brightRed}
            illustration={<EndSessionIcon />}
          />
        </View>
        {isSimulationInProgress && (
          <SimulationControls
            isMaximized={isControlButtonMaximized}
            onToggleMaximized={() => setIsControlButtonMaximized(prev => !prev)}
            isMicEnabled={isMicEnabled}
            onMicToggle={handleToggleMic}
            isFocusMode={isFocusMode}
            onFocusModeToggle={() => setIsFocusMode(prev => !prev)}
            onEndSession={handleDisconnect}
            isSimulationInProgress={isSimulationInProgress}
            showFocusButton={!isNoneMode}
            isPaused={isPaused}
            // Opt-in default — only an explicit `true` shows the pause
            // control (missing/false → hidden).
            onPauseToggle={
              scenario?.pauseEnabled === true ? handleTogglePause : undefined
            }
          />
        )}
        {/* Full-screen and rendered last so it stacks above the loader,
            call UI, and controls alike — covers and blocks touches to all of
            them for the fixed 3s window, whatever roomStatus is doing. */}
        {countdownStep !== null && (
          <SimulationCountdown
            step={countdownStep}
            label={t('simulationPage.simulationCountdownLabel')}
          />
        )}
      </RoomContext.Provider>
    </SafeAreaView>
  );
};
