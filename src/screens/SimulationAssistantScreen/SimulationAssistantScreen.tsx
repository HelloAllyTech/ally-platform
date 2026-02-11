import React, {useCallback, useEffect, useRef, useState} from 'react';
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
import {SafeAreaView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import SoundPlayer from 'react-native-sound-player';

import {sounds} from '@/assets';
import {EndSessionIcon} from '@/assets/icons';
import {IllustratedModal, useErrorToast} from '@/components';
import {
  DEFAULT_MAX_TIME_VALUE,
  MINUTES_IN_MS,
  SCREEN_NAMES,
  SECONDS_IN_MS,
  SESSION_AUTO_END_MINUTES,
  SESSION_END_MODAL_MINUTES,
  SESSION_END_MODAL_SECONDS,
} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler, useUser} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useEndScenarioSessionMutation} from '@/services';
import {colors} from '@/theme';
import {
  ChecklistType,
  ExperienceMode,
  Feedback,
  LiveEventPayload,
} from '@/types';
import {
  decodeFeedbackPayloadToJson,
  getTriggerWarningNames,
  logger,
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
  const insets = useSafeAreaInsets();
  const {sessionData, scenario, pathId, contextType} = route.params;
  const isChecklistMode = scenario?.experienceMode === ExperienceMode.CHECKLIST;
  const {liveKitServerUrl, accessToken, id: sessionId} = sessionData;
  const [startTime, setStartTime] = useState<Date | null>(null);
  const navigation = useAppNavigation();
  const {t} = useTranslation();
  const [endScenarioSession] = useEndScenarioSessionMutation();
  const {showErrorToast} = useErrorToast();
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
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
  const [showEndingSoon, setShowEndingSoon] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [isControlButtonMaximized, setIsControlButtonMaximized] =
    useState<boolean>(false);
  const [showBackPressConfirmation, setShowBackPressConfirmation] =
    useState<boolean>(false);
  const isSimulationInProgress = !isConnecting && !isDisconnecting;

  const clamp = useCallback((val: number, min: number, max: number) => {
    return Math.min(Math.max(val, min), max);
  }, []);

  useEffect(() => {
    if (accessToken) {
      setIsConnecting(true);
      // Delay connection to allow ringtone to play (matching web behavior)
      const connectionTimeout = setTimeout(() => {
        handleConnect();
        setStartTime(new Date());
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

  useEffect(() => {
    // Show the ending-soon modal at 29 minutes 30 seconds from the start time
    if (!startTime) return;

    const modalTargetMs =
      SESSION_END_MODAL_MINUTES * MINUTES_IN_MS +
      SESSION_END_MODAL_SECONDS * SECONDS_IN_MS;
    const autoEndTargetMs = SESSION_AUTO_END_MINUTES * MINUTES_IN_MS;

    const now = Date.now();
    const elapsed = now - startTime.getTime();

    const remainingModal = Math.max(0, modalTargetMs - elapsed);
    const remainingAutoEnd = Math.max(0, autoEndTargetMs - elapsed);

    const modalTimer = setTimeout(
      () => setShowEndingSoon(true),
      remainingModal,
    );
    const autoEndTimer = setTimeout(() => {
      if (!isDisconnecting) handleDisconnect();
    }, remainingAutoEnd);

    return () => {
      clearTimeout(modalTimer);
      clearTimeout(autoEndTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, isDisconnecting]);

  const ensureSpeakerOutput = useCallback(async () => {
    // Try a few times with small delays; OEM skins sometimes override routing during focus changes
    const attempts = 3;
    for (let currAttempt = 0; currAttempt < attempts; currAttempt++) {
      try {
        await AudioSession.startAudioSession();
        await AudioSession.selectAudioOutput('speaker');
        break;
      } catch (error) {
        logger.error(`Failed to ensure speaker output: ${error}`);
      }
      await new Promise(res => setTimeout(res, 200));
    }
  }, []);

  const attachRoomListeners = useCallback(() => {
    const onConnected = async () => {
      setIsConnecting(false);
      // Stop the ringtone once the room is connected (matching web behavior)
      try {
        SoundPlayer.stop();
      } catch {
        // Ignore if sound already finished
      }
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
        await ensureSpeakerOutput();
      } catch (error) {
        showErrorToast(error, 'Errors.attachListeners');
      }
    };
    const onDisconnected = () => {
      setIsConnecting(false);
      if (!isDisconnecting) {
        playNotificationSound(sounds.endSimulation);
        setIsDisconnecting(true);
        setIsMicEnabled(false);
        navigation.replace(SCREEN_NAMES.SIMULATION_FEEDBACK, {
          scenarioSessionId: sessionId,
          pathId,
          contextType, // Pass contextType so feedback screen knows if this is a case or track
        });
        setIsDisconnecting(false);
      }
    };
    const onDataReceived = (payload: unknown) => {
      const eventObj = decodeFeedbackPayloadToJson(payload) as LiveEventPayload;
      if (!eventObj?.data) return;

      const {score, emoji, message, detected_event_ids} = eventObj.data;

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
      .on(RoomEvent.DataReceived, onDataReceived);
    return () => {
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.DataReceived, onDataReceived);
    };
  }, [
    room,
    ensureSpeakerOutput,
    showErrorToast,
    isDisconnecting,
    navigation,
    sessionId,
    pathId,
    contextType,
    clamp,
  ]);

  useEffect(() => attachRoomListeners(), [attachRoomListeners]);

  useEffect(() => {
    playNotificationSound(sounds.startSimulation);
  }, []);

  const configureAudioSession = async () => {
    try {
      await AudioSession.configureAudio({
        // Keep speaker output but engage inCommunication mode to help AEC
        android: {
          preferredOutputList: ['speaker'],
          audioTypeOptions: {
            ...AndroidAudioTypePresets.media,
            audioMode: 'inCommunication',
            forceHandleAudioRouting: true,
            audioAttributesUsageType: 'voiceCommunication',
          },
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
      setIsDisconnecting(true);
      playNotificationSound(sounds.endSimulation);
      await room.disconnect();
      await endScenarioSession({
        scenarioSessionId: sessionId,
      });
    } finally {
      navigation.replace(SCREEN_NAMES.SIMULATION_FEEDBACK, {
        scenarioSessionId: sessionId,
        pathId,
        contextType, // Pass contextType so feedback screen knows if this is a case or track
      });
      setIsMicEnabled(false);
      setIsDisconnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pathId, contextType]);

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
    return (
      <View style={styles.loadingWrapper}>
        <Text style={styles.loadingTitle}>
          {t('SimulationAssistant.startingTitle')}
          <Text style={styles.loadingItalic}>
            {isDisconnecting
              ? t('SimulationAssistant.endingEllipsis')
              : t('SimulationAssistant.startingEllipsis')}
          </Text>
        </Text>
        {isConnecting && (
          <Text style={styles.loadingDescription}>
            {t('SimulationAssistant.startingSubtitle')}
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, {paddingTop: insets.top}]}>
      <RoomContext.Provider value={room}>
        <View style={styles.contentContainer}>
          {isSimulationInProgress && startTime && (
            <SimulationTimer startTime={startTime} />
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
                      />
                    </View>
                  </View>
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

          {isSimulationInProgress && !isChecklistMode && (
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
