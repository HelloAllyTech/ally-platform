import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RouteProp, useIsFocused} from '@react-navigation/native';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import {
  ActivityIndicator,
  AppState,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {LockIcon} from '@/assets';
import {PrivacyTooltip} from '@/components';
import {env} from '@/config/env';
import {AllyPlatforms, AUDIO_INACTIVE_TIMEOUT, SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useCounselorChat,
  useDebounce,
  useHardwareBackPressHandler,
  useLiveAudioStream,
  useNetworkConnectivity,
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
  ConferenceCallProviders,
  DisconnectedType,
  FeedbackResponse,
  Nudge,
  SocketEvent,
  SocketMessage,
} from '@/types';
import {Maybe} from '@/utils';

import {
  AudioWaveformContainer,
  CallEndConfirmationModal,
  ControlButtonsSection,
  DismissableBanner,
  NetworkDisconnected,
  NudgeSection,
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

export const ListeningScreen = ({
  route,
}: {
  route: RouteProp<RootStackParamList, 'Listening'>;
}) => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const dispatch = useAppDispatch();
  const isFocused = useIsFocused();
  const {isOffline} = useNetworkConnectivity();
  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const {checkCounselorChat} = useCounselorChat();
  const [endCall, {isSuccess: isEndCallSuccess, isError: isEndCallError}] =
    useEndCallMutation();
  const {userData} = useUser();
  const chatData = useAppSelector(state => state.chat.currentChat);

  const callProvider = chatData?.provider;

  const isMicrophoneMode =
    route.params?.isMicrophoneMode ||
    chatData?.provider === ChatProvider.MICROPHONE;
  const isWebMicrophoneMode =
    callProvider === ChatProvider.MICROPHONE &&
    chatData?.platform === AllyPlatforms.WEB;
  const isConferenceCall =
    callProvider && ConferenceCallProviders.includes(callProvider);

  const [isFocusMode, setIsFocusMode] = useState(true);
  const [currentNudge, setCurrentNudge] = useState<Maybe<Nudge>>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCallPaused, setIsCallPaused] = useState(isWebMicrophoneMode);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [showCallEndConfirmation, setShowCallEndConfirmation] = useState(false);
  const [isAudioChatEmitted, setIsAudioChatEmitted] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isPrivacyTooltipVisible, setIsPrivacyTooltipVisible] = useState(false);
  const [isControlSectionMaximized, setIsControlSectionMaximized] =
    useState(true);
  const [isMicrophoneModeSessionCreated, setIsMicrophoneModeSessionCreated] =
    useState(false);
  const [disconnectedType, setDisconnectedType] =
    useState<DisconnectedType | null>(null);

  const streamingInitialized = useRef(false);

  // Use ref to always access the latest isCallPaused value inside audio event callback,
  // since react-native-live-audio-stream registers the handler once and won't re-subscribe
  // on state changes, avoiding unnecessary re-inits of the stream.
  const isCallPausedRef = useRef(isCallPaused);
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const latestAmplitudesRef = useRef<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );
  const chatIdRef = useRef(chatData?.chatId);
  const tooltipContentList = [
    t('ListeningScreen.dataSafeTooltip.noAudioRecordings'),
    t('ListeningScreen.dataSafeTooltip.dataEncrypted'),
    t('ListeningScreen.dataSafeTooltip.noTrainingData'),
    t('ListeningScreen.dataSafeTooltip.personalInfoRemoved'),
  ];

  const startTime = useMemo(
    () =>
      chatData?.startedAt
        ? new Date(chatData?.startedAt).getTime()
        : Date.now(),
    [chatData?.startedAt],
  );

  const handleCallEndRedirection = useCallback(() => {
    // Only navigate if the ListeningScreen is still focused
    if (isFocused) {
      navigation.replace(SCREEN_NAMES.BREATHING);
    }
  }, [navigation, isFocused]);

  const getSocketPath = useCallback(() => {
    if (isConferenceCall) return env.CLOUD_TELEPHONY_PATH;
    if (isMicrophoneMode) return env.MICROPHONE_SOCKET_PATH;
    return env.WEBRTC_SOCKET_PATH;
  }, [isConferenceCall, isMicrophoneMode]);

  useEffect(() => {
    if (isOffline && isMicrophoneMode && !isWebMicrophoneMode) {
      setDisconnectedType(DisconnectedType.NETWORK);
    }
  }, [isOffline, isMicrophoneMode, isWebMicrophoneMode]);

  useEffect(() => {
    // Handling redirection for both success and error cases to prevent user getting stuck in the listening screen
    if (isEndCallSuccess || isEndCallError) {
      handleCallEndRedirection();
    }
  }, [isEndCallSuccess, handleCallEndRedirection, isEndCallError]);

  useEffect(() => {
    isCallPausedRef.current = isCallPaused;
  }, [isCallPaused]);

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !isMicrophoneMode,
    });
  }, [isMicrophoneMode, navigation]);

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

  const handleEndCall = () => {
    const {chatId} = chatData || {};

    if (!chatId) return;

    if (isMicrophoneMode && !isWebMicrophoneMode) {
      stopStreaming();
      streamingInitialized.current = false;
    }

    endCall({chatId});
  };

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.SESSION_CREATED]: () => {
        setIsMicrophoneModeSessionCreated(true);
      },
      [SocketEvent.CHAT_ENDED]: () => {
        handleCallEndRedirection();
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
    [
      handleCallEndRedirection,
      isAudioActive,
      isConferenceCall,
      checkCounselorChat,
    ],
  );

  const onDisconnectSocket = () => {
    if (isMicrophoneMode && !isWebMicrophoneMode) {
      setDisconnectedType(
        isOffline ? DisconnectedType.NETWORK : DisconnectedType.SOCKET,
      );
    }
  };

  const onConnectionError = () => {
    if (isMicrophoneMode && !isWebMicrophoneMode) {
      setDisconnectedType(DisconnectedType.SOCKET);
    }
  };

  // Automatically manages socket connection based on screen focus and app state
  const {emitSocketEvent} = useSocketConnection({
    path: getSocketPath(),
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
    onDisconnect: onDisconnectSocket,
    onConnectionError: onConnectionError,
  });

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

  const handleLockIconPress = useCallback(() => {
    setIsPrivacyTooltipVisible(prev => !prev);
  }, []);

  const handlePrivacyTooltipClose = useCallback(() => {
    setIsPrivacyTooltipVisible(false);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        // Add delay to allow permission flow to complete and prevent race condition
        setTimeout(() => {
          if (
            isMicrophoneMode &&
            !isWebMicrophoneMode &&
            !isPermissionGranted
          ) {
            return;
          }

          getCounsellorChat().then(res => {
            if (
              !res.data ||
              (Array.isArray(res.data) && res.data.length === 0)
            ) {
              // Clear chat state before navigation
              dispatch(clearCurrentChat());
              navigation.reset({
                index: 0,
                routes: [{name: SCREEN_NAMES.CALL_LOG}],
              });
            }
          });
        }, 500);
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
  const isWebrtcOrMicrophoneMode = useMemo(
    () =>
      callProvider &&
      [ChatProvider.WEBRTC, ChatProvider.MICROPHONE].includes(callProvider),
    [callProvider],
  );

  const handleTryAgain = useCallback(() => {
    dispatch(clearCurrentChat());
    setDisconnectedType(null);
    navigation.goBack();
    navigation.reset({
      index: 1,
      routes: [
        {name: SCREEN_NAMES.CALL_LOG},
        {name: SCREEN_NAMES.LISTENING, params: route.params},
      ],
    });
  }, [navigation, route.params, dispatch]);

  const handleNetworkDisconnectedGoBack = useCallback(() => {
    dispatch(clearCurrentChat());
    navigation.goBack();
  }, [navigation, dispatch]);

  const tooltipContent = (
    <View style={styles.tooltipContent}>
      {tooltipContentList.map((item, index) => (
        <Text key={index} style={styles.tooltipText}>
          • {item}
        </Text>
      ))}
    </View>
  );

  const tooltipDisplayInsets = {
    left: isFocusMode ? 40 : 10,
    right: isFocusMode ? 40 : 10,
    top: 10,
    bottom: 10,
  };

  const renderTakingNotes = () => {
    return (
      <View style={styles.takingNotesContainer}>
        <PrivacyTooltip
          tooltipContent={tooltipContent}
          isVisible={isPrivacyTooltipVisible}
          onClose={handlePrivacyTooltipClose}
          placement={isFocusMode ? 'top' : 'bottom'}
          displayInsets={tooltipDisplayInsets}>
          <TouchableOpacity
            onPress={handleLockIconPress}
            disabled={!isFocusMode}
            activeOpacity={0.8}>
            <LockIcon width={16} height={16} color={colors.lightGrayD9} />
          </TouchableOpacity>
        </PrivacyTooltip>
        <Text style={styles.takingNotesText}>
          {t('ListeningScreen.takingNotes')}
        </Text>
      </View>
    );
  };

  if (disconnectedType) {
    return (
      <View style={styles.container}>
        <NetworkDisconnected
          onRetry={handleTryAgain}
          onGoBack={handleNetworkDisconnectedGoBack}
          disconnectedType={disconnectedType}
        />
      </View>
    );
  }

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

  const renderFocusMode = () => {
    return (
      <>
        {isConferenceCall && !isBannerDismissed && (
          <DismissableBanner onClose={() => setIsBannerDismissed(true)} />
        )}
        <View style={styles.focusModeLayout}>
          {renderTakingNotes()}
          <Timer startTime={startTime} />
          <View style={styles.focusModeWaveformWrapper}>
            <AudioWaveformContainer
              latestAmplitudesRef={latestAmplitudesRef}
              isCallPaused={isCallPaused}
              isFocusMode
            />
          </View>
          {isMicrophoneMode && !isWebMicrophoneMode && (
            <Text style={styles.microphoneModeNote}>
              {t('ListeningScreen.microphoneModeNote')}
            </Text>
          )}
        </View>
      </>
    );
  };

  const renderNonFocusMode = () => {
    return (
      <View style={styles.nonFocusModeLayout}>
        <View style={globalStyles.rowCenter}>
          <View style={styles.nonFocusLabelBlock}>
            {renderTakingNotes()}
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
        {!!nudgeStatus && currentNudge && (
          <NudgeSection
            nudge={currentNudge}
            isLoading={isLoading}
            onFeedbackSuccess={handleNudgeFeedbackSuccess}
          />
        )}
        <Search />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {showCallEndConfirmation && callEndModalElement}
      <StatusBar
        backgroundColor="transparent"
        translucent
        barStyle="light-content"
      />
      {isFocusMode ? renderFocusMode() : renderNonFocusMode()}
      <ControlButtonsSection
        isMaximized={isControlSectionMaximized}
        onToggleMaximized={() => setIsControlSectionMaximized(prev => !prev)}
        onFocusModeButtonPress={toggleNudgeVisibility}
        isFocusMode={isFocusMode}
        onCallEndPress={() => setShowCallEndConfirmation(true)}
        isCallPaused={isCallPaused}
        onPauseResumePress={handlePlayPauseCallPress}
        showPauseResumeButton={isWebrtcOrMicrophoneMode}
        showEndSessionButton={isWebrtcOrMicrophoneMode}
        isPauseResumeDisabled={isMicrophoneMode && isWebMicrophoneMode}
      />
    </View>
  );
};
