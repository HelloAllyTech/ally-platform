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
import {Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import SoundPlayer from 'react-native-sound-player';

import {sounds} from '@/assets';
import {EndSessionIcon} from '@/assets/icons';
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
} from '@/utils';

import {
  EndingSoonModal,
  LiveFeedback,
  SessionChecklist,
  SessionGoalTimer,
  SessionScoreMeter,
  SimulationControls,
  SimulationTimer,
} from './components';
import {ParticipantTile} from './components/ParticipantTile/ParticipantTile';
import {
  ScenarioInfoOverlay,
  ScenarioInfoOverlayRef,
} from './components/ScenarioInfoOverlay';
import {styles} from './styles';

const RINGING_BELL_DELAY = 5000; // 5 seconds for ringing the bell before connecting

type Props = RootStackScreenProps<'SimulationAssistant'>;

export const SimulationAssistantScreen: React.FC<Props> = ({route}) => {
  const {sessionData, scenario, pathId, caseId, languageId} = route.params;
  const isChecklistMode = scenario?.experienceMode === ExperienceMode.CHECKLIST;
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
  const [agentTurnStatus, setAgentTurnStatus] = useState<AgentTurnStatus>('user_turn');
  const agentTurnStatusRef = useRef<AgentTurnStatus>('user_turn');
  const [debouncedRemoteSpeaking, setDebouncedRemoteSpeaking] = useState(false);
  const remoteSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showEndingSoon, setShowEndingSoon] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [isControlButtonMaximized, setIsControlButtonMaximized] =
    useState<boolean>(false);
  const [showBackPressConfirmation, setShowBackPressConfirmation] =
    useState<boolean>(false);
  const isSimulationInProgress =
    roomStatus === RoomStatus.AGENT_JOINED ||
    roomStatus === RoomStatus.CONNECTED;

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
  }, [agentTurnStatus, debouncedRemoteSpeaking, localParticipant?.isSpeaking]);

  useEffect(() => {
    if (accessToken) {
      setRoomStatus(RoomStatus.CONNECTING);
      // Delay connection to allow ringtone to play (matching web behavior)
      const connectionTimeout = setTimeout(() => {
        handleConnect();
      }, RINGING_BELL_DELAY);

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
    const onConnected = async () => {
      setRoomStatus(RoomStatus.CONNECTED);
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
        // await ensureCorrectAudioOutput();
      } catch (error) {
        showErrorToast(error, 'Errors.attachListeners');
      }
    };

    const onRemoteParticipantConnected = () => {
      // Stop the ringtone once the agent joins (matching web behavior)
      try {
        SoundPlayer.stop();
      } catch {
        // Ignore if sound already finished
      }
      setStartTime(new Date());
      setRoomStatus(RoomStatus.AGENT_JOINED);
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
      .on(RoomEvent.DataReceived, onDataReceived);
    return () => {
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.ParticipantConnected, onRemoteParticipantConnected)
        .off(RoomEvent.DataReceived, onDataReceived);
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
      showErrorToast(error, 'Errors.audioSession');
    }
  };

  const handleConnect = useCallback(async () => {
    try {
      await configureAudioSession();
      await room.connect(liveKitServerUrl, accessToken);
    } catch (error) {
      showErrorToast(error, 'Errors.connect');
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
      showErrorToast(error, 'Errors.toggleMic');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicEnabled]);

  const renderLoader = () => {
    const getLoadingText = () => {
      if (
        roomStatus === RoomStatus.CONNECTED ||
        roomStatus === RoomStatus.CONNECTING
      ) {
        return t('SimulationAssistant.waitingForAgent');
      }
      if (roomStatus === RoomStatus.DISCONNECTING) {
        return t('SimulationAssistant.ending');
      }
      return t('SimulationAssistant.connectingToSession');
    };

    return (
      <View style={styles.loadingWrapper}>
        <Text style={styles.loadingTitle}>
          <Text style={styles.loadingItalic}>{getLoadingText()}</Text>
        </Text>
        {roomStatus === RoomStatus.CONNECTING && (
          <Text style={styles.loadingDescription}>
            {t('SimulationAssistant.startingSubtitle')}
          </Text>
        )}
      </View>
    );
  };

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
            />
          )}
          <>
            {isSimulationInProgress &&
              isChecklistMode &&
              scenario?.checklistEvents &&
              scenario?.checklistEvents.length > 0 && (
                <View style={styles.participantsContent}>
                  <View
                    style={[
                      styles.participantsContainer,
                      styles.participantsHorizontal,
                      styles.participantsCompact,
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
                    </View>
                    <View style={styles.participantWrapper}>
                      <ParticipantTile
                        participant={localParticipant}
                        publication={localAudioPub}
                        avatarUrl={userData?.profileImageUrl ?? null}
                        name={userData?.name}
                        isMicEnabled={isMicEnabled}
                        turnState={localTurnState}
                      />
                    </View>
                  </View>
                  {isSimulationInProgress && !isFocusMode && (
                    <View style={styles.checklistWrapper}>
                      <SessionChecklist
                        mode={
                          scenario.checklistType
                            ? scenario.checklistType
                            : ChecklistType.OFF
                        }
                        items={scenario.checklistEvents}
                        triggeredEvents={detectedEvents}
                      />
                    </View>
                  )}
                </View>
              )}
          </>
          <>
            {!isSimulationInProgress
              ? renderLoader()
              : !isChecklistMode && (
                  <>
                    <View style={styles.participantsContent}>
                      <View
                        style={[
                          styles.participantsContainer,
                          isFocusMode
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
                        </View>
                        <View style={styles.participantWrapper}>
                          <ParticipantTile
                            participant={localParticipant}
                            publication={localAudioPub}
                            avatarUrl={userData?.profileImageUrl ?? null}
                            name={userData?.name}
                            isMicEnabled={isMicEnabled}
                            turnState={localTurnState}
                          />
                        </View>
                      </View>
                    </View>
                    {!isFocusMode && feedback && (
                      <View style={styles.liveFeedbackWrapper}>
                        <LiveFeedback
                          key={feedbackKey}
                          message={feedback.text}
                          emoji={feedback.emoji}
                        />
                      </View>
                    )}
                  </>
                )}
          </>

          {isSimulationInProgress && scenario?.showScoreMeter !== false && (
            <View style={styles.scoreMeterContainer}>
              <SessionScoreMeter score={accumulatedScore} />
            </View>
          )}

          <EndingSoonModal
            visible={showEndingSoon && isSimulationInProgress}
            titleMain={t('SimulationAssistant.session')}
            titleItalic={t('SimulationAssistant.endingSoon')}
            description={t('SimulationAssistant.sessionWillEnd')}
            onContinue={() => setShowEndingSoon(false)}
            onEndSession={handleDisconnect}
          />

          <IllustratedModal
            visible={showBackPressConfirmation}
            onClose={() => setShowBackPressConfirmation(false)}
            description={t('SimulationAssistant.endSimulationConfirmation')}
            actionButtonText={t('SimulationAssistant.endSimulation')}
            titleMain={t('ListeningScreen.end')}
            titleItalic={t('Simulations.simulation')}
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
          />
        )}
      </RoomContext.Provider>
    </SafeAreaView>
  );
};
