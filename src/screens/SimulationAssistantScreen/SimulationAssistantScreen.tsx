import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RoomContext,
} from '@livekit/react-native';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import {Room, RoomEvent} from 'livekit-client';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {useErrorToast} from '@/components';
import {
  MINUTES_IN_MS,
  SCREEN_NAMES,
  SECONDS_IN_MS,
  SESSION_AUTO_END_MINUTES,
  SESSION_END_MODAL_MINUTES,
  SESSION_END_MODAL_SECONDS,
} from '@/constants';
import {useAppNavigation} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useEndScenarioSessionMutation} from '@/services';
import {colors, fontFamily} from '@/theme';
import {Feedback, LiveEventPayload} from '@/types';
import {decodeFeedbackPayloadToJson, logger} from '@/utils';

import {
  AudioWave,
  ControlButtons,
  EndingSoonModal,
  LiveFeedback,
  SessionScoreMeter,
  SimulationTimer,
} from './components';

type Props = RootStackScreenProps<'SimulationAssistant'>;

export const SimulationAssistantScreen: React.FC<Props> = ({route}) => {
  const insets = useSafeAreaInsets();
  const {roomData, scenario} = route.params;
  const {liveKitServerUrl, accessToken, id: roomId} = roomData;
  const startTime = useMemo(
    () => (roomData?.createdAt ? new Date(roomData?.createdAt) : new Date()),
    [roomData?.createdAt],
  );
  const navigation = useAppNavigation();
  const {t} = useTranslation();
  const [endScenarioSession] = useEndScenarioSessionMutation();
  const {showErrorToast} = useErrorToast();
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [room] = useState<Room>(() => new Room());

  const [feedback, setFeedback] = useState<Feedback>(null);
  const [feedbackKey, setFeedbackKey] = useState<number>(0);
  const [accumulatedScore, setAccumulatedScore] = useState<number>(0);
  const [showEndingSoon, setShowEndingSoon] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [isControlButtonMaximized, setIsControlButtonMaximized] =
    useState<boolean>(false);

  const clamp = useCallback((val: number, min: number, max: number) => {
    return Math.min(Math.max(val, min), max);
  }, []);

  useEffect(() => {
    if (accessToken) {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    activateKeepAwake();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

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
    for (let i = 0; i < attempts; i++) {
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
    };
    const onDataReceived = (payload: unknown) => {
      const eventObj = decodeFeedbackPayloadToJson(payload) as LiveEventPayload;
      if (!eventObj?.data) return;

      const {score, emoji, message} = eventObj.data;

      if (typeof score === 'number' && !Number.isNaN(score)) {
        setAccumulatedScore(prev => clamp(prev + score, -100, 100));
      }

      if (message && typeof message === 'string') {
        const id = Date.now();
        const next = {id, text: message, emoji: emoji ?? undefined};
        setFeedback(next);
        setFeedbackKey(next.id);
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
  }, [room, showErrorToast, clamp, ensureSpeakerOutput]);

  useEffect(() => attachRoomListeners(), [attachRoomListeners]);

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
      });
    } catch (error) {
      showErrorToast(error, 'Errors.audioSession');
    }
  };

  const handleConnect = useCallback(async () => {
    try {
      await configureAudioSession();
      setIsConnecting(true);
      await room.connect(liveKitServerUrl, accessToken);
    } catch (error) {
      showErrorToast(error, 'Errors.connect');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, liveKitServerUrl]);

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      await room.disconnect();
      await endScenarioSession({
        scenarioSessionId: roomId,
      });
    } finally {
      navigation.replace(SCREEN_NAMES.SIMULATION_FEEDBACK, {
        simulationId: roomId,
      });
      setIsMicEnabled(false);
      setIsDisconnecting(false);
    }
  };

  const handleToggleMic = async () => {
    try {
      const next = !isMicEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setIsMicEnabled(next);
    } catch (error) {
      showErrorToast(error, 'Errors.toggleMic');
    }
  };

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

  const isSimulationInProgress = !isConnecting && !isDisconnecting;

  return (
    <SafeAreaView
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <RoomContext.Provider value={room}>
        <View style={styles.contentContainer}>
          {isSimulationInProgress && startTime && (
            <SimulationTimer startTime={startTime} />
          )}
          <View style={styles.centralContainer}>
            {!isSimulationInProgress ? (
              renderLoader()
            ) : (
              <>
                <AudioWave avatarUrl={scenario?.coverImageUrl ?? undefined} />
                {!!scenario?.title && (
                  <Text style={styles.personaLabel}>{scenario.title}</Text>
                )}
                {!isFocusMode && (
                  <View
                    style={[
                      styles.liveFeedbackWrapper,
                      isControlButtonMaximized && styles.bottom51,
                    ]}>
                    {feedback && (
                      <LiveFeedback
                        key={feedbackKey}
                        message={feedback.text}
                        emoji={feedback.emoji}
                      />
                    )}
                  </View>
                )}
              </>
            )}
          </View>

          {isSimulationInProgress && (
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
        </View>
        <ControlButtons
          isMaximized={isControlButtonMaximized}
          onToggleMaximized={() => setIsControlButtonMaximized(prev => !prev)}
          isFocusMode={isFocusMode}
          isFocusModeDisabled={!isSimulationInProgress}
          onFocusModeButtonPress={() => setIsFocusMode(prev => !prev)}
          isSimulationEndDisabled={!isSimulationInProgress}
          onSimulationEndPress={handleDisconnect}
          isMicDisabled={!isSimulationInProgress}
          onMicButtonPress={handleToggleMic}
          isMuted={!isMicEnabled}
        />
      </RoomContext.Provider>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkGray7,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: '16@ms',
  },
  centralContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '8@ms',
    marginTop: '10@mvs',
    marginBottom: '16@mvs',
    backgroundColor: colors.darkGray3,
  },
  liveFeedbackWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '81@mvs',
  },
  bottom51: {
    bottom: '51@mvs',
  },
  loadingWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: '40@ms',
  },
  loadingTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.white,
    textAlign: 'center',
    marginBottom: '4@mvs',
  },
  loadingItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  loadingDescription: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
  },
  personaLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
    textAlign: 'left',
    marginHorizontal: '20@ms',
    marginBottom: '16@ms',
    width: '100%',
  },
  scoreMeterContainer: {
    marginBottom: '24@mvs',
  },
});
