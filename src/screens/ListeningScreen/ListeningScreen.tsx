import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RouteProp, useIsFocused} from '@react-navigation/native';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import {ActivityIndicator, AppState, StatusBar, Text, View} from 'react-native';

import {env} from '@/config/env';
import {AllyPlatforms, AUDIO_INACTIVE_TIMEOUT, SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useCounselorChat,
  useDebounce,
  useHardwareBackPressHandler,
  useLiveAudioStream,
  useSocketConnection,
  useTranslate,
  useUser,
} from '@/hooks';
import {RootStackParamList} from '@/navigation';
import {useGetNudgeStatusQuery} from '@/services';
import {
  useEndCallMutation,
  useLazyGetCounsellorChatQuery,
} from '@/services/chatApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {colors, globalStyles} from '@/theme';
import {
  ChatProvider,
  FeedbackResponse,
  SocketEvent,
  SocketMessage,
} from '@/types';
import {Maybe} from '@/utils';

import {
  AudioWaveformContainer,
  CallEndConfirmationModal,
  ControlButtonsSection,
  NudgeSection,
  PlayPauseOverlay,
  Search,
  Timer,
} from './components';
import {styles} from './styles';
import {
  exotelAudioDataToAmplitudes,
  getStartAudioChatPayload,
  NUM_BARS,
  recorderAudioToAmplitudes,
  webRTCAudioDataToAmplitudes,
} from './utils';

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
  const dispatch = useAppDispatch();
  const isFocused = useIsFocused();

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
  const isConferenceCall = callProvider === ChatProvider.EXOTEL_CONFERENCE_CALL;
  const [currentNudge, setCurrentNudge] = useState<Maybe<Nudge>>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isWebMicrophoneMode =
    callProvider === ChatProvider.MICROPHONE &&
    chatData?.platform === AllyPlatforms.WEB;
  const [isCallPaused, setIsCallPaused] = useState(isWebMicrophoneMode);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [showCallEndConfirmation, setShowCallEndConfirmation] = useState(false);
  const [isAudioChatEmitted, setIsAudioChatEmitted] = useState(false);
  const streamingInitialized = useRef(false);

  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [isControlSectionMaximized, setIsControlSectionMaximized] =
    useState(true);
  const [isMicrophoneModeSessionCreated, setIsMicrophoneModeSessionCreated] =
    useState(false);
  const latestAmplitudesRef = useRef<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
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
    // Only navigate if the ListeningScreen is still focused
    if (isFocused) {
      navigation.replace(SCREEN_NAMES.BREATHING);
    }
  }, [navigation, isFocused]);

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
    const {chatId} = chatData || {};

    if (!chatId) return;

    if (isMicrophoneMode && !isWebMicrophoneMode) {
      stopStreaming();
      streamingInitialized.current = false;
    }

    endCall({chatId});
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
      if (isWebMicrophoneMode) {
        dispatch(clearCurrentChat());
        navigation.goBack();
      } else if (chatData?.chatId) {
        setShowCallEndConfirmation(true);
      }
      return true;
    }
    navigation.goBack();
    return true;
  });

  const {checkCounselorChat} = useCounselorChat();

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
      [SocketEvent.USER_JOINED]: async () => {
        await checkCounselorChat();
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
    [onCallEndSuccess, isAudioActive, isConferenceCall, checkCounselorChat],
  );

  const {userData} = useUser();
  // Automatically manages socket connection based on screen focus and app state
  const {emitSocketEvent} = useSocketConnection({
    path: getSocketPath(),
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

  const chatIdRef = useRef(chatData?.chatId);

  useEffect(() => {
    chatIdRef.current = chatData?.chatId;
  }, [chatData?.chatId]);

  const handleAudioData = useCallback(
    (base64Wav: string) => {
      latestAmplitudesRef.current = recorderAudioToAmplitudes(base64Wav);
      if (
        !isCallPausedRef.current &&
        !isWebMicrophoneMode &&
        chatIdRef.current
      ) {
        emitSocketEvent(SocketEvent.AUDIO_MESSAGE, {
          audioData: base64Wav,
          chatId: chatIdRef.current,
        });
      }
    },
    [emitSocketEvent, isWebMicrophoneMode],
  );

  const {startStreaming, stopStreaming, isPermissionGranted} =
    useLiveAudioStream({
      onAudioData: handleAudioData,
      enableLiveAudio: isMicrophoneMode && !isWebMicrophoneMode,
    });

  const isAudioSessionReady = useMemo(() => {
    return (
      isMicrophoneMode &&
      isPermissionGranted &&
      isMicrophoneModeSessionCreated &&
      !isWebMicrophoneMode
    );
  }, [
    isMicrophoneMode,
    isPermissionGranted,
    isMicrophoneModeSessionCreated,
    isWebMicrophoneMode,
  ]);

  useEffect(() => {
    if (
      isAudioSessionReady &&
      chatData?.chatId &&
      !streamingInitialized.current
    ) {
      streamingInitialized.current = true;
      startStreaming();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioSessionReady, chatData?.chatId]);

  useEffect(() => {
    if (isAudioSessionReady && !isAudioChatEmitted) {
      // This is to prevent socket event from being emitted before the
      // socket connection is established (Flow: permission denied and then granted from settings)
      setTimeout(() => {
        emitSocketEvent(
          SocketEvent.START_AUDIO_CHAT,
          getStartAudioChatPayload(),
        );
        setIsAudioChatEmitted(true);
      });
    }
  }, [
    isAudioSessionReady,
    emitSocketEvent,
    isAudioChatEmitted,
    isPermissionGranted,
  ]);

  // Keep screen awake during microphone mode calls
  useEffect(() => {
    if (isMicrophoneMode) {
      try {
        activateKeepAwake();
      } catch (error) {
        console.warn('Failed to activate keep awake:', error);
      }
    }

    // Cleanup function to deactivate keep awake when component unmounts or mode changes
    return () => {
      try {
        deactivateKeepAwake();
      } catch (error) {
        console.warn('Failed to deactivate keep awake:', error);
      }
    };
  }, [isMicrophoneMode]);

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
        // Skip chat validation in microphone mode without permission to prevent navigation to Home
        // after returning from permission dialog (chat session isn't ready yet)
        if (isMicrophoneMode && !isWebMicrophoneMode && !isPermissionGranted) {
          return;
        }
        getCounsellorChat().then(res => {
          if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
            // Clear chat state before navigation
            dispatch(clearCurrentChat());
            navigation.navigate(SCREEN_NAMES.CALL_LOG);
          }
        });
      }
    });
    return () => {
      subscription.remove();
    };
  }, [
    chatData?.chatId,
    emitSocketEvent,
    getCounsellorChat,
    isMicrophoneMode,
    isPermissionGranted,
    isWebMicrophoneMode,
    navigation,
    dispatch,
  ]);

  const callEndModalElement = (
    <CallEndConfirmationModal
      visible={showCallEndConfirmation}
      onClose={() => setShowCallEndConfirmation(false)}
      onConfirm={handleEndCall}
      isMicrophoneMode={isMicrophoneMode}
    />
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
      {showCallEndConfirmation && callEndModalElement}
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
            <AudioWaveformContainer
              latestAmplitudesRef={latestAmplitudesRef}
              isCallPaused={isCallPaused}
              isFocusMode
            />
          </View>
          {playPauseButton}
          {isMicrophoneMode && !isWebMicrophoneMode && (
            <Text style={styles.microphoneModeNote}>
              {t('ListeningScreen.microphoneModeNote')}
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
              <AudioWaveformContainer
                latestAmplitudesRef={latestAmplitudesRef}
                isCallPaused={isCallPaused}
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
        />
      </View>
    </View>
  );
};
