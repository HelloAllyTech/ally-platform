import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RoomContext,
} from '@livekit/react-native';
import {Room, RoomEvent} from 'livekit-client';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {useErrorToast} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation} from '@/hooks';
import type {RootStackScreenProps} from '@/navigation/types';
import {useEndScenarioSessionMutation} from '@/services';
import {colors, fontFamily} from '@/theme';

import {
  AudioWave,
  ControlButtons,
  SessionScoreMeter,
  SimulationTimer,
} from './components';

type Props = RootStackScreenProps<'SimulationAssistant'>;

type Feedback = {id: number; text: string; emoji?: string} | null;

export const SimulationAssistantScreen: React.FC<Props> = ({route}) => {
  const insets = useSafeAreaInsets();
  const {roomData, scenario} = route.params;
  const {liveKitServerUrl, accessToken, id: roomId} = roomData;
  const startTime = roomData?.createdAt
    ? new Date(roomData?.createdAt)
    : new Date();
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

  // TODO: Remove this later
  const sampleFeedbacks = useMemo(
    () =>
      [
        {
          text: 'Try asking an open ended question to get client to open up',
          emoji: '😬',
        },
        {text: "Reflect the client's feelings to build rapport", emoji: '🤝'},
        {text: 'Summarize what you heard and check for accuracy', emoji: '📝'},
        {
          text: 'Allow a brief silence to give space for reflection',
          emoji: '🤫',
        },
      ] as Array<{text: string; emoji: string}>,
    [],
  );

  useEffect(() => {
    if (accessToken) {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachRoomListeners = useCallback(() => {
    const onConnected = () => {
      setIsConnecting(false);
      try {
        room.localParticipant.setMicrophoneEnabled(true);
        setIsMicEnabled(true);
      } catch (error) {
        showErrorToast(error, 'Errors.attachListeners');
      }
    };
    const onDisconnected = () => {
      setIsConnecting(false);
    };
    const onDataReceived = (
      payload: any,
      participant: any,
      kind: any,
      topic: any,
    ) => {
      const participantIdentity = participant?.identity || 'unknown';
      // TODO: Remove this later Log the raw data received
      console.log('DataReceived', {
        participant: participantIdentity,
        kind: kind,
        topic: topic,
        payload: payload,
      });
    };
    const onTrackPublished = () => {
      // console.log('TrackPublished');
    };
    room
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.TrackPublished, onTrackPublished)
      .on(RoomEvent.DataReceived, onDataReceived);
    return () => {
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.TrackPublished, onTrackPublished)
        .off(RoomEvent.DataReceived, onDataReceived);
    };
  }, [room, showErrorToast]);

  useEffect(() => attachRoomListeners(), [attachRoomListeners]);

  const configureAudioSession = async () => {
    try {
      await AudioSession.configureAudio({
        // This configures the audio session to route to speaker first instead of phone speaker
        android: {
          preferredOutputList: ['speaker'],
          audioTypeOptions: AndroidAudioTypePresets.media,
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
      const response = await endScenarioSession({
        scenarioSessionId: roomId,
      });
      if (!response.error) {
        navigation.replace(SCREEN_NAMES.SIMULATION_FEEDBACK, {
          simulationId: roomId,
        });
      }
    } finally {
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

  const showSimulationLoading = isConnecting || isDisconnecting;

  // TODO: Replace with backend stream
  useEffect(() => {
    // Initial
    const firstIndex = Math.floor(Math.random() * sampleFeedbacks.length);
    const first = sampleFeedbacks[firstIndex];
    const firstId = Date.now();
    setFeedback({id: firstId, text: first.text, emoji: first.emoji});
    setFeedbackKey(firstId);

    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * sampleFeedbacks.length);
      const item = sampleFeedbacks[idx];
      const id = Date.now();
      setFeedback({id, text: item.text, emoji: item.emoji});
      setFeedbackKey(id);
    }, 3000);

    return () => clearInterval(interval);
  }, [sampleFeedbacks]);

  return (
    <SafeAreaView
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <RoomContext.Provider value={room}>
        <View style={styles.contentContainer}>
          {!showSimulationLoading && startTime && (
            <SimulationTimer startTime={startTime} />
          )}
          <View style={styles.centralContainer}>
            {showSimulationLoading ? (
              renderLoader()
            ) : (
              <>
                <AudioWave avatarUrl={scenario?.coverImageUrl ?? undefined} />
                {!!scenario?.title && (
                  <Text style={styles.personaLabel}>{scenario.title}</Text>
                )}
                {/* <View style={styles.liveFeedbackWrapper}>
                  {feedback && (
                    <LiveFeedback
                      key={feedbackKey}
                      message={feedback.text}
                      emoji={feedback.emoji}
                    />
                  )}
                </View> */}
              </>
            )}
          </View>

          {!showSimulationLoading && (
            <View style={styles.scoreMeterContainer}>
              {/* TODO: Replace with backend score */}
              <SessionScoreMeter score={0} />
            </View>
          )}

          <ControlButtons
            onMicPress={handleToggleMic}
            onStopPress={handleDisconnect}
            isDisableMic={showSimulationLoading}
            isDisableStop={isDisconnecting}
            isMuted={!isMicEnabled}
          />
        </View>
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
    marginLeft: '20@ms',
    marginBottom: '16@ms',
    width: '100%',
  },
  scoreMeterContainer: {
    marginBottom: '24@mvs',
  },
});
