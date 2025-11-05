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
import {AUDIO_INACTIVE_TIMEOUT} from '@/constants';
import {
  useDebounce,
  useListeningScreen,
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
  DismissableBanner,
  NudgeSection,
  Search,
  Timer,
} from '../components';
import {useListeningCommon} from '../hooks';
import {styles} from '../styles';
import {exotelAudioDataToAmplitudes, NUM_BARS} from '../utils';

interface ConferenceListeningScreenProps {
  route: RouteProp<RootStackParamList, 'Listening'>;
}

export const ConferenceListeningScreen = ({
  route: _route,
}: ConferenceListeningScreenProps) => {
  const {t} = useTranslate();
  const {isOffline} = useNetworkConnectivity();
  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const {userData} = useUser();

  const isMicrophoneMode = false; // Always false for conference calls

  const [isFocusMode, setIsFocusMode] = useState(true);
  const [isCallPaused, setIsCallPaused] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);

  // Get chatData and isWebMicrophoneMode from common hook
  const {
    chatData,
    isWebMicrophoneMode: _isWebMicrophoneMode,
    isFocusMode: commonFocusMode,
    currentNudge,
    isLoading,
    showCallEndConfirmation,
    isBannerDismissed,
    isPrivacyTooltipVisible,
    isControlSectionMaximized,
    setShowCallEndConfirmation,
    setIsBannerDismissed,
    setIsControlSectionMaximized,
    setDisconnectedType,
    setCurrentNudge,
    setIsLoading,
    handleCallEndRedirection,
    handleEndCall: handleEndCallCommon,
    handleNudgeFeedbackSuccess,
    toggleFocusMode: toggleFocusModeCommon,
    handleLockIconPress,
    handlePrivacyTooltipClose,
    checkCounselorChat,
    canShowFocusModeButton,
  } = useListeningCommon({
    isMicrophoneMode,
  });

  // Use chatData from common hook in useListeningScreen
  const {
    isConferenceCall,
    tooltipContentList,
    tooltipDisplayInsets,
    startTime,
  } = useListeningScreen({
    isMicrophoneMode,
    isFocusMode: isFocusMode,
    chatData,
  });

  // Sync local focus mode with common
  useEffect(() => {
    setIsFocusMode(commonFocusMode);
  }, [commonFocusMode]);

  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const latestAmplitudesRef = useRef<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );

  // Handle offline state
  useEffect(() => {
    if (isOffline) {
      setDisconnectedType(DisconnectedType.NETWORK);
    }
  }, [isOffline, setDisconnectedType]);

  // Socket event callbacks
  const socketEventCallbacks = useMemo(
    () => ({
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
        if (data.payload?.audioData && isConferenceCall) {
          latestAmplitudesRef.current = exotelAudioDataToAmplitudes(
            data.payload.audioData as string,
          );
        }

        // Clear any existing timeout
        if (audioTimeoutRef.current) {
          clearTimeout(audioTimeoutRef.current);
        }

        // Set new timeout to mark audio as inactive
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
      setIsLoading,
      setCurrentNudge,
    ],
  );

  const onConnectionError = useCallback(() => {
    setDisconnectedType(DisconnectedType.SOCKET);
  }, [setDisconnectedType]);

  // Socket connection
  const {emitSocketEvent} = useSocketConnection({
    path: env.CLOUD_TELEPHONY_PATH,
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
    onConnectionError: onConnectionError,
  });

  // Clear audio timeout on unmount
  useEffect(() => {
    return () => {
      if (audioTimeoutRef.current) {
        clearTimeout(audioTimeoutRef.current);
      }
    };
  }, []);

  // Handle call end
  const handleEndCall = useCallback(() => {
    handleEndCallCommon();
  }, [handleEndCallCommon]);

  // Pause/Resume handler
  const handlePlayPauseCallPress = useDebounce(
    () => {
      emitSocketEvent(
        isCallPaused
          ? SocketEvent.AUDIO_CHAT_RESUMED
          : SocketEvent.AUDIO_CHAT_PAUSED,
        {chatId: chatData?.chatId},
      );
      setIsCallPaused(prev => !prev);
    },
    {delay: 500},
  );

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
      {isFocusMode ? renderFocusMode() : renderNonFocusMode()}
      <ControlButtonsSection
        isMaximized={isControlSectionMaximized}
        onToggleMaximized={() => setIsControlSectionMaximized(prev => !prev)}
        onFocusModeButtonPress={toggleFocusModeCommon}
        isFocusMode={isFocusMode}
        onCallEndPress={() => setShowCallEndConfirmation(true)}
        isCallPaused={isCallPaused}
        onPauseResumePress={handlePlayPauseCallPress}
        showPauseResumeButton={false}
        showEndSessionButton={false}
        isPauseResumeDisabled={false}
        showFocusModeButton={canShowFocusModeButton}
      />
    </View>
  );
};
