import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RouteProp} from '@react-navigation/native';
import {
  ActivityIndicator,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {LockIcon} from '@/assets';
import {PrivacyTooltip} from '@/components';
import {env} from '@/config/env';
import {
  useDebounce,
  useListeningScreen,
  useLiveAudioStream,
  useNetworkConnectivity,
  useSocketConnection,
  useTranslate,
  useUser,
} from '@/hooks';
import {RootStackParamList} from '@/navigation';
import {useGetNudgeStatusQuery} from '@/services';
import {colors, globalStyles} from '@/theme';
import {DisconnectedType, SocketEvent, SocketMessage} from '@/types';

import {
  AudioWaveformContainer,
  CallEndConfirmationModal,
  ControlButtonsSection,
  NetworkDisconnected,
  NudgeSection,
  Search,
  Timer,
} from '../components';
import {useListeningCommon} from '../hooks';
import {styles} from '../styles';
import {
  getStartAudioChatPayload,
  NUM_BARS,
  recorderAudioToAmplitudes,
} from '../utils';

interface MicrophoneListeningScreenProps {
  route: RouteProp<RootStackParamList, 'Listening'>;
}

export const MicrophoneListeningScreen = ({
  route: _route,
}: MicrophoneListeningScreenProps) => {
  const {t} = useTranslate();
  const {isOffline} = useNetworkConnectivity();
  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const {userData} = useUser();

  const isMicrophoneMode = true; // Always true for this screen

  const [isFocusModeLocal, setIsFocusModeLocal] = useState(true);
  const [isCallPaused, setIsCallPaused] = useState(false);
  const [isAudioChatEmitted, setIsAudioChatEmitted] = useState(false);
  const [isMicrophoneModeSessionCreated, setIsMicrophoneModeSessionCreated] =
    useState(false);
  const [isPermissionGrantedLocal, setIsPermissionGrantedLocal] =
    useState(false);

  // Get chatData and isWebMicrophoneMode from common hook
  const {
    chatData,
    isWebMicrophoneMode,
    isFocusMode: commonFocusMode,
    currentNudge,
    isLoading,
    showCallEndConfirmation,
    isPrivacyTooltipVisible,
    isControlSectionMaximized,
    disconnectedType,
    setShowCallEndConfirmation,
    setIsControlSectionMaximized,
    setDisconnectedType,
    setCurrentNudge,
    setIsLoading,
    handleCallEndRedirection,
    handleGoBack,
    handleEndCall: handleEndCallCommon,
    handleNudgeFeedbackSuccess,
    toggleFocusMode: toggleFocusModeCommon,
    handleLockIconPress,
    handlePrivacyTooltipClose,
    checkCounselorChat,
    canShowFocusModeButton,
  } = useListeningCommon({
    isMicrophoneMode,
    isPermissionGranted: isPermissionGrantedLocal,
  });

  // Use chatData from common hook in useListeningScreen
  const {tooltipContentList, tooltipDisplayInsets, startTime} =
    useListeningScreen({
      isMicrophoneMode,
      isFocusMode: isFocusModeLocal,
      chatData,
    });

  // Sync local focus mode with common
  useEffect(() => {
    setIsFocusModeLocal(commonFocusMode);
  }, [commonFocusMode]);

  const streamingInitialized = useRef(false);
  const chatIdTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const isCallPausedRef = useRef(isCallPaused);
  const isWebMicrophoneModeRef = useRef(isWebMicrophoneMode);
  const chatIdRef = useRef(chatData?.chatId);
  const latestAmplitudesRef = useRef<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );

  // Update refs
  useEffect(() => {
    isCallPausedRef.current = isCallPaused;
  }, [isCallPaused]);

  useEffect(() => {
    isWebMicrophoneModeRef.current = isWebMicrophoneMode;
  }, [isWebMicrophoneMode]);

  useEffect(() => {
    chatIdRef.current = chatData?.chatId;
  }, [chatData?.chatId]);

  // Handle offline state
  useEffect(() => {
    if (isOffline && !isWebMicrophoneMode) {
      setDisconnectedType(DisconnectedType.NETWORK);
    }
  }, [isOffline, isWebMicrophoneMode, setDisconnectedType]);

  // Handle chatId timeout for connection failure
  useEffect(() => {
    const clearChatIdTimeout = () => {
      if (chatIdTimeoutRef.current) {
        clearTimeout(chatIdTimeoutRef.current);
        chatIdTimeoutRef.current = null;
      }
    };

    if (!chatData?.chatId) {
      chatIdTimeoutRef.current = setTimeout(() => {
        setDisconnectedType(DisconnectedType.MICROPHONE_FAILURE);
      }, 5000);
    } else {
      clearChatIdTimeout();
    }

    return clearChatIdTimeout;
  }, [chatData?.chatId, setDisconnectedType]);

  // Socket event callbacks
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
    }),
    [
      handleCallEndRedirection,
      checkCounselorChat,
      setIsLoading,
      setCurrentNudge,
    ],
  );

  const onDisconnectSocket = useCallback(() => {
    if (!isWebMicrophoneMode) {
      setDisconnectedType(
        isOffline ? DisconnectedType.NETWORK : DisconnectedType.SOCKET,
      );
    }
  }, [isOffline, isWebMicrophoneMode, setDisconnectedType]);

  const onConnectionError = useCallback(() => {
    if (!isWebMicrophoneMode) {
      setDisconnectedType(DisconnectedType.SOCKET);
    }
  }, [isWebMicrophoneMode, setDisconnectedType]);

  // Socket connection
  const {emitSocketEvent} = useSocketConnection({
    path: env.MICROPHONE_SOCKET_PATH,
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
    onDisconnect: onDisconnectSocket,
    onConnectionError: onConnectionError,
  });

  // Audio data handler
  const handleAudioData = useCallback(
    (base64Wav: string) => {
      latestAmplitudesRef.current = recorderAudioToAmplitudes(base64Wav);
      if (
        !isCallPausedRef.current &&
        !isWebMicrophoneMode &&
        !isWebMicrophoneModeRef.current &&
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

  // Live audio stream
  const {startStreaming, stopStreaming, isPermissionGranted} =
    useLiveAudioStream({
      onAudioData: handleAudioData,
      enableLiveAudio: !isWebMicrophoneMode,
    });

  // Sync permission state
  useEffect(() => {
    setIsPermissionGrantedLocal(isPermissionGranted);
  }, [isPermissionGranted]);

  // Audio session ready check
  const isAudioSessionReady = useMemo(
    () =>
      isPermissionGranted &&
      isMicrophoneModeSessionCreated &&
      !isWebMicrophoneMode,
    [isPermissionGranted, isMicrophoneModeSessionCreated, isWebMicrophoneMode],
  );

  // Start streaming on mount
  useEffect(() => {
    if (!isWebMicrophoneMode && !streamingInitialized.current) {
      streamingInitialized.current = true;
      startStreaming();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit START_AUDIO_CHAT when session is ready
  useEffect(() => {
    if (isAudioSessionReady && !isAudioChatEmitted) {
      setTimeout(() => {
        emitSocketEvent(
          SocketEvent.START_AUDIO_CHAT,
          getStartAudioChatPayload(),
        );
        setIsAudioChatEmitted(true);
      });
    }
  }, [isAudioSessionReady, emitSocketEvent, isAudioChatEmitted]);

  // Handle call end
  const handleEndCall = useCallback(() => {
    handleEndCallCommon(() => {
      stopStreaming();
      streamingInitialized.current = false;
    });
  }, [handleEndCallCommon, stopStreaming]);

  // Pause/Resume handler
  const handlePlayPauseCallPress = useDebounce(
    () => {
      setIsCallPaused(prev => !prev);
    },
    {delay: 500},
  );

  // Retry handler
  const handleTryAgain = useCallback(() => {
    setDisconnectedType(null);
    handleGoBack();
  }, [handleGoBack, setDisconnectedType]);

  const tooltipContent = (
    <View style={styles.tooltipContent}>
      {tooltipContentList.map((item, index) => (
        <Text key={index} style={styles.tooltipText}>
          • {item}
        </Text>
      ))}
    </View>
  );

  const renderTakingNotes = () => {
    return (
      <View style={styles.takingNotesContainer}>
        <PrivacyTooltip
          tooltipContent={tooltipContent}
          isVisible={isPrivacyTooltipVisible}
          onClose={handlePrivacyTooltipClose}
          placement={isFocusModeLocal ? 'top' : 'bottom'}
          displayInsets={tooltipDisplayInsets}>
          <TouchableOpacity
            onPress={handleLockIconPress}
            disabled={!isFocusModeLocal}
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

  // Disconnected state
  if (disconnectedType) {
    return (
      <View style={styles.container}>
        <NetworkDisconnected
          onRetry={handleTryAgain}
          onGoBack={handleGoBack}
          disconnectedType={disconnectedType}
        />
      </View>
    );
  }

  // Loading state
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
        {!isWebMicrophoneMode && (
          <Text style={styles.microphoneModeNote}>
            {t('ListeningScreen.microphoneModeNote')}
          </Text>
        )}
      </View>
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
      {showCallEndConfirmation && (
        <CallEndConfirmationModal
          visible={showCallEndConfirmation}
          onClose={() => setShowCallEndConfirmation(false)}
          onConfirm={handleEndCall}
          isMicrophoneMode={isMicrophoneMode}
        />
      )}
      <StatusBar
        backgroundColor="transparent"
        translucent
        barStyle="light-content"
      />
      {isFocusModeLocal ? renderFocusMode() : renderNonFocusMode()}
      <ControlButtonsSection
        isMaximized={isControlSectionMaximized}
        onToggleMaximized={() => setIsControlSectionMaximized(prev => !prev)}
        onFocusModeButtonPress={toggleFocusModeCommon}
        isFocusMode={isFocusModeLocal}
        onCallEndPress={() => setShowCallEndConfirmation(true)}
        isCallPaused={isCallPaused}
        onPauseResumePress={handlePlayPauseCallPress}
        showPauseResumeButton
        showEndSessionButton
        isPauseResumeDisabled={isWebMicrophoneMode}
        showFocusModeButton={canShowFocusModeButton}
      />
    </View>
  );
};
