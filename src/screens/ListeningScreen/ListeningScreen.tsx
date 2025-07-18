import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RouteProp} from '@react-navigation/native';
import {ActivityIndicator, AppState, StatusBar, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {env} from '@/config/env';
import {AUDIO_INACTIVE_TIMEOUT} from '@/constants/chat';
import {AllyPlatforms, MICROPHONE_AUDIO_SAMPLE_RATE} from '@/constants/general';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useDebounce} from '@/hooks/useDebounce';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {useLiveAudioStream} from '@/hooks/useLiveAudioStream';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {RootStackParamList} from '@/navigation/types';
import {
  useEndCallMutation,
  useLazyGetCounsellorChatQuery,
} from '@/services/chatApi';
import {useGetNudgeStatusQuery} from '@/services/settingsApi';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {globalStyles} from '@/theme/helpers';
import {
  ChatProvider,
  FeedbackResponse,
  SocketEvent,
  SocketMessage,
} from '@/types/message';
import {Maybe} from '@/utils/common';
import {logger} from '@/utils/logger';

import {
  exotelAudioDataToAmplitudes,
  NUM_BARS,
  recorderAudioToAmplitudes,
  webRTCAudioDataToAmplitudes,
} from './audioUtils';
import {
  CallEndModal,
  ControlButtonsSection,
  NudgeSection,
  Timer,
} from './components';
import {AudioWaveform} from './components/AudioWaveform';
import {PlayPauseOverlay} from './components/PlayPauseOverlay/PlayPauseOverlay';
import Search from './components/Search/Search';

export interface Nudge {
  id: number;
  content: string;
  chatId: number;
  senderId: number;
  createdAt: string;
  feedback?: FeedbackResponse;
}

export const ListeningScreen = ({
  route,
}: {
  route: RouteProp<RootStackParamList, 'Listening'>;
}) => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();

  const [isFocusMode, setIsFocusMode] = useState(true);
  const chatData = useAppSelector(state => state.chat.currentChat);

  const startTime = useMemo(
    () =>
      chatData?.startedAt
        ? new Date(chatData?.startedAt).getTime()
        : Date.now(),
    [chatData?.startedAt],
  );
  const callProvider = chatData?.provider;
  const isConferenceCall = callProvider === ChatProvider.EXOTEL;
  const [currentNudge, setCurrentNudge] = useState<Maybe<Nudge>>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isWebMicrophoneMode =
    callProvider === ChatProvider.MICROPHONE &&
    chatData?.platform === AllyPlatforms.WEB;
  const [isCallPaused, setIsCallPaused] = useState(isWebMicrophoneMode);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [showCallEndConfirmation, setShowCallEndConfirmation] = useState(false);
  const [isAudioChatEmitted, setIsAudioChatEmitted] = useState(false);

  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [isControlSectionMaximized, setIsControlSectionMaximized] =
    useState(true);
  const [isMicrophoneModeSessionCreated, setIsMicrophoneModeSessionCreated] =
    useState(false);
  const [amplitudes, setAmplitudes] = useState<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const latestAmplitudesRef = useRef<number[] | null>(amplitudes);
  // Use ref to always access the latest isCallPaused value inside audio event callback,
  // since react-native-live-audio-stream registers the handler once and won't re-subscribe
  // on state changes, avoiding unnecessary re-inits of the stream.
  const isCallPausedRef = useRef(isCallPaused);

  // Current chat won't be available initially for microphone mode flow
  // as the new chat is created only on emitting the event START_AUDIO_CHAT
  const isMicrophoneMode =
    route.params?.isMicrophoneMode ||
    chatData?.provider === ChatProvider.MICROPHONE;

  const [endCall, {isSuccess: isEndCallSuccess}] = useEndCallMutation();

  const onCallEndSuccess = useCallback(() => {
    navigation.navigate('Breathing');
  }, [navigation]);

  const getSocketPath = useCallback(() => {
    if (isConferenceCall || isMicrophoneMode) {
      return env.MICROPHONE_SOCKET_PATH;
    }
    return env.WEBRTC_SOCKET_PATH;
  }, [isConferenceCall, isMicrophoneMode]);

  useEffect(() => {
    if (isEndCallSuccess) {
      onCallEndSuccess();
    }
  }, [isEndCallSuccess, onCallEndSuccess]);

  useEffect(() => {
    isCallPausedRef.current = isCallPaused;
  }, [isCallPaused]);

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !isMicrophoneMode,
    });
  }, [isMicrophoneMode, navigation]);

  const handleEndCall = () => {
    if (chatData?.chatId) {
      if (isConferenceCall || isMicrophoneMode) {
        if (isMicrophoneMode) {
          stopStreaming();
        }
        emitSocketEvent(SocketEvent.AUDIO_CHAT_ENDED, {
          ...(chatData?.chatId &&
            isConferenceCall && {chatId: chatData.chatId}),
        });
      } else {
        // Webrtc call
        endCall({chatId: chatData.chatId});
      }
    }
  };

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (audioTimeoutRef.current) {
        clearTimeout(audioTimeoutRef.current);
      }
    };
  }, []);

  useHardwareBackPressHandler(() => {
    if (isMicrophoneMode) {
      setShowCallEndConfirmation(true);
      return true;
    }
    navigation.goBack();
    return true;
  });

  // Throttle waveform updates to every 120ms
  useEffect(() => {
    const interval = setInterval(() => {
      setAmplitudes(latestAmplitudesRef.current);
    }, 120);
    return () => clearInterval(interval);
  }, []);

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.SESSION_CREATED]: () => {
        setIsMicrophoneModeSessionCreated(true);
      },
      [SocketEvent.CHAT_ENDED]: () => {
        onCallEndSuccess();
      },
      [SocketEvent.NUDGE]: (data: SocketMessage) => {
        if (data.payload) {
          setIsLoading(true);
          setTimeout(() => {
            setCurrentNudge({
              id: data.payload!.id,
              content: data.payload!.content,
              chatId: data.payload!.chatId,
              senderId: data.payload!.senderId,
              createdAt: data.payload!.createdAt,
              feedback: data.payload!.feedback,
            });
            setIsLoading(false);
          }, 500);
        }
      },
      [SocketEvent.AUDIO_STREAM]: (data: SocketMessage) => {
        if (!isAudioActive) {
          setIsAudioActive(true);
        }
        // Process audioData to amplitudes
        if (data.payload?.audioData) {
          if (isConferenceCall) {
            latestAmplitudesRef.current = exotelAudioDataToAmplitudes(
              data.payload.audioData as string,
            );
          } else {
            latestAmplitudesRef.current = webRTCAudioDataToAmplitudes(
              data.payload.audioData as string,
            );
          }
        }
        // Clear any existing timeout
        if (audioTimeoutRef.current) {
          clearTimeout(audioTimeoutRef.current);
        }
        // Set new timeout to mark audio as inactive if no new messages come
        audioTimeoutRef.current = setTimeout(() => {
          setIsAudioActive(false);
          latestAmplitudesRef.current = null; // trigger fade out
        }, AUDIO_INACTIVE_TIMEOUT);
      },
    }),
    [onCallEndSuccess, isAudioActive, isConferenceCall],
  );

  const {userData} = useUser();
  // Automatically manages socket connection based on screen focus and app state
  const {emitSocketEvent} = useSocketConnection({
    path: getSocketPath(),
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

  const handleAudioData = useCallback(
    (base64Wav: string) => {
      latestAmplitudesRef.current = recorderAudioToAmplitudes(base64Wav);
      if (!isCallPausedRef.current && !isWebMicrophoneMode) {
        emitSocketEvent(SocketEvent.AUDIO_MESSAGE, {
          audioData: base64Wav,
          chatId: chatData?.chatId,
        });
      }
    },
    [emitSocketEvent, chatData?.chatId, isWebMicrophoneMode],
  );

  const {startStreaming, stopStreaming, isPermissionGranted} =
    useLiveAudioStream({
      onAudioData: handleAudioData,
      enableLiveAudio: isMicrophoneMode,
    });

  const handleStartStreaming = useCallback(async () => {
    try {
      if (!isPermissionGranted) {
        logger.warn('Cannot start streaming: permission not granted');
        return;
      }
      await startStreaming();
    } catch (error) {
      logger.error(`Error starting stream: ${error}`);
    }
  }, [startStreaming, isPermissionGranted]);

  useEffect(() => {
    if (
      isMicrophoneMode &&
      isPermissionGranted &&
      isMicrophoneModeSessionCreated &&
      !isAudioChatEmitted
    ) {
      emitSocketEvent(SocketEvent.START_AUDIO_CHAT, {
        isLinear16Encoded: true,
        platform: AllyPlatforms.MOBILE,
        sampleRate: MICROPHONE_AUDIO_SAMPLE_RATE,
        ...(chatData?.chatId && {activeChatId: chatData.chatId}),
      });
      setIsAudioChatEmitted(true);
      handleStartStreaming();
    }
  }, [
    chatData?.chatId,
    isAudioChatEmitted,
    emitSocketEvent,
    isMicrophoneMode,
    isPermissionGranted,
    handleStartStreaming,
    isMicrophoneModeSessionCreated,
  ]);

  const handleNudgeFeedbackSuccess = (feedback: FeedbackResponse) => {
    if (currentNudge) {
      setCurrentNudge(prev => {
        if (prev) {
          return {
            ...prev,
            feedback: feedback,
          };
        }
        return prev;
      });
    }
  };
  const toggleNudgeVisibility = () => {
    setIsFocusMode(prev => !prev);
  };

  const handlePlayPauseCallPress = useDebounce(
    () => {
      if (!isMicrophoneMode) {
        emitSocketEvent(
          isCallPaused
            ? SocketEvent.AUDIO_CHAT_RESUMED
            : SocketEvent.AUDIO_CHAT_PAUSED,
          {chatId: chatData?.chatId},
        );
      }
      setIsCallPaused(prev => !prev);
    },
    {delay: 500},
  );

  const playPauseButton = useMemo(() => {
    return (
      <PlayPauseOverlay
        isPlaying={!isCallPaused}
        onPress={handlePlayPauseCallPress}
        isFocusMode={isFocusMode}
        isDisabled={isWebMicrophoneMode}
      />
    );
  }, [
    isCallPaused,
    handlePlayPauseCallPress,
    isFocusMode,
    isWebMicrophoneMode,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        getCounsellorChat().then(res => {
          if (!res.data) {
            navigation.navigate('Home');
          }
        });
      }
    });
    return () => {
      subscription.remove();
    };
  }, [getCounsellorChat, navigation]);

  const isCallEndDisabled = useMemo(
    () => !chatData?.chatId || isWebMicrophoneMode,
    [chatData?.chatId, isWebMicrophoneMode],
  );

  if (!chatData?.chatId) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.white} />
        <Text style={styles.loadingText}>
          {t('ListeningScreen.connecting')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {showCallEndConfirmation && (
        <CallEndModal
          showCallEndConfirmation={showCallEndConfirmation}
          setShowCallEndConfirmation={setShowCallEndConfirmation}
          handleEndCall={handleEndCall}
          isMicrophoneMode={!!isMicrophoneMode}
        />
      )}
      <StatusBar
        backgroundColor="transparent"
        translucent
        barStyle="light-content"
      />
      {isFocusMode ? (
        <View style={styles.focusModeLayout}>
          <Text style={styles.takingNotesText}>
            {t('ListeningScreen.takingNotes')}
          </Text>
          <Timer startTime={startTime} />
          <View style={styles.focusModeWaveformWrapper}>
            <AudioWaveform
              amplitudes={isCallPaused ? null : amplitudes}
              isFocusMode
            />
          </View>
          {playPauseButton}
          {isWebMicrophoneMode && (
            <Text style={styles.microphoneModeInDifferentPlatform}>
              {t('ListeningScreen.microphoneModeInDifferentPlatform')}
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.nonFocusModeLayout}>
          <View style={globalStyles.rowCenter}>
            {playPauseButton}
            <View style={styles.nonFocusLabelBlock}>
              <Text style={styles.takingNotesText}>
                {t('ListeningScreen.takingNotes')}
              </Text>
              <Timer startTime={startTime} />
            </View>
            <View style={styles.nonFocusModeWaveformWrapper}>
              <AudioWaveform
                amplitudes={isCallPaused ? null : amplitudes}
                isFocusMode={false}
              />
            </View>
          </View>
          {!isFocusMode && !!nudgeStatus && currentNudge && (
            <NudgeSection
              nudge={currentNudge}
              isLoading={isLoading}
              onFeedbackSuccess={handleNudgeFeedbackSuccess}
            />
          )}
          <Search />
        </View>
      )}

      <View style={styles.controlButtonsContainer}>
        <ControlButtonsSection
          isMaximized={isControlSectionMaximized}
          onToggleMaximized={() => setIsControlSectionMaximized(prev => !prev)}
          onFocusModeButtonPress={toggleNudgeVisibility}
          isFocusMode={isFocusMode}
          onCallEndPress={() => setShowCallEndConfirmation(true)}
          isCallEndDisabled={isCallEndDisabled}
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkGray7,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.darkGray7,
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
    marginTop: '10@vs',
  },
  controlButtonsContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusModeLayout: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: '40@vs',
  },
  takingNotesText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
    textAlign: 'left',
  },
  nonFocusLabelBlock: {
    alignItems: 'flex-start',
    flex: 1,
    marginLeft: '10@s',
  },
  focusModeWaveformWrapper: {
    marginVertical: '40@vs',
    width: '96%',
  },
  nonFocusModeWaveformWrapper: {
    width: '50%',
  },
  nonFocusModeLayout: {
    flex: 1,
    alignItems: 'flex-start',
    paddingHorizontal: '20@s',
    marginTop: '40@vs',
  },
  microphoneModeInDifferentPlatform: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
    textAlign: 'center',
    marginTop: '20@vs',
    marginHorizontal: '20@s',
  },
});
