import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StatusBar, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {AUDIO_INACTIVE_TIMEOUT} from '@/constants/chat';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useDebounce} from '@/hooks/useDebounce';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useEndCallMutation} from '@/services/chatApi';
import {useGetNudgeStatusQuery} from '@/services/settingsApi';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {globalStyles} from '@/theme/helpers';
import {FeedbackResponse, SocketEvent, SocketMessage} from '@/types/message';
import {Maybe} from '@/utils/common';

import {audioDataToAmplitudes, NUM_BARS} from './audioUtils';
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

export const ListeningScreen = () => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const [isFocusMode, setIsFocusMode] = useState(true);
  const chat = useAppSelector(state => state.chat.currentChat);
  const [startTime] = useState(() =>
    chat?.startedAt ? new Date(chat.startedAt).getTime() : Date.now(),
  );
  const [currentNudge, setCurrentNudge] = useState<Maybe<Nudge>>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCallPaused, setIsCallPaused] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [showCallEndConfirmation, setShowCallEndConfirmation] = useState(false);
  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [isControlSectionMaximized, setIsControlSectionMaximized] =
    useState(true);
  const [amplitudes, setAmplitudes] = useState<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );
  const latestAmplitudesRef = useRef<number[] | null>(amplitudes);

  const chatData = useAppSelector(state => state.chat.currentChat);
  const [endCall, {isSuccess}] = useEndCallMutation();

  const handleCallEnd = useCallback(() => {
    navigation.navigate('Breathing');
  }, [navigation]);

  useEffect(() => {
    if (isSuccess) {
      handleCallEnd();
    }
  }, [isSuccess, handleCallEnd]);

  const handleEndCall = () => {
    if (chatData?.chatId) {
      endCall({chatId: chatData.chatId});
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
    navigation.goBack();
    return true;
  });

  // Throttle waveform updates to every 120ms
  useEffect(() => {
    const interval = setInterval(() => {
      // Generate random amplitudes for visual testing
      // TO DO: Remove this later
      const randomAmplitudes = Array.from({length: NUM_BARS}, () =>
        Math.random(),
      );
      setAmplitudes(latestAmplitudesRef.current);
      // setAmplitudes(randomAmplitudes);
    }, 120);
    return () => clearInterval(interval);
  }, []);

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.CHAT_ENDED]: () => {
        handleCallEnd();
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
          latestAmplitudesRef.current = audioDataToAmplitudes(
            data.payload.audioData,
          );
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
    [handleCallEnd, isAudioActive],
  );

  const {userData} = useUser();
  // Automatically manages socket connection based on screen focus and app state
  const {emitSocketEvent} = useSocketConnection({
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

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
      // TODO: Implement API call to send feedback
    }
  };

  const toggleNudgeVisibility = () => {
    setIsFocusMode(prev => !prev);
  };

  const handlePlayPauseCallPress = useDebounce(
    () => {
      emitSocketEvent(
        isCallPaused
          ? SocketEvent.AUDIO_CHAT_RESUMED
          : SocketEvent.AUDIO_CHAT_PAUSED,
        {chatId: chat?.chatId},
      );
      setIsCallPaused(prev => !prev);
    },
    {delay: 500},
  );

  return (
    <View style={styles.container}>
      {showCallEndConfirmation && (
        <CallEndModal
          showCallEndConfirmation={showCallEndConfirmation}
          setShowCallEndConfirmation={setShowCallEndConfirmation}
          handleEndCall={handleEndCall}
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
              amplitudes={isAudioActive ? amplitudes : null}
              isFocusMode
            />
          </View>
          <PlayPauseOverlay
            isPlaying={!isCallPaused}
            onPress={handlePlayPauseCallPress}
            isFocusMode
          />
        </View>
      ) : (
        <View style={styles.nonFocusModeLayout}>
          <View style={globalStyles.rowCenter}>
            <PlayPauseOverlay
              isPlaying={!isCallPaused}
              onPress={handlePlayPauseCallPress}
              isFocusMode={false}
            />
            <View style={styles.nonFocusLabelBlock}>
              <Text style={styles.takingNotesText}>
                {t('ListeningScreen.takingNotes')}
              </Text>
              <Timer startTime={startTime} />
            </View>
            <View style={styles.nonFocusModeWaveformWrapper}>
              <AudioWaveform
                amplitudes={isAudioActive ? amplitudes : null}
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

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkGray7,
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
    width: '90%',
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
});
