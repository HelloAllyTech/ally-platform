import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StatusBar, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {AUDIO_INACTIVE_TIMEOUT} from '@/constants/chat';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useDebounce} from '@/hooks/useDebounce';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';
import {FeedbackResponse, SocketEvent, SocketMessage} from '@/types/message';
import {Maybe} from '@/utils/common';

import {AnimatedBlob} from './components/AnimatedBlob';
import {ControlButtons} from './components/ControlButtons';
import {NudgeSection} from './components/NudgeSection';
import {Timer} from './components/Timer/Timer';

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
  const dispatch = useAppDispatch();
  const [isNudgeVisible, setIsNudgeVisible] = useState(false);
  const chat = useAppSelector(state => state.chat.currentChat);
  const [startTime] = useState(() =>
    chat?.startedAt ? new Date(chat.startedAt).getTime() : Date.now(),
  );
  const [currentNudge, setCurrentNudge] = useState<Maybe<Nudge>>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCallPaused, setIsCallPaused] = useState(false);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (audioTimeoutRef.current) {
        clearTimeout(audioTimeoutRef.current);
      }
    };
  }, []);

  const handleCallEnd = useCallback(() => {
    navigation.navigate('Breathing');
  }, [navigation]);

  useHardwareBackPressHandler(() => {
    handleCallEnd();
    return true;
  });

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.CHAT_ENDED]: () => {
        handleCallEnd();
      },
      [SocketEvent.NUDGE]: (data: SocketMessage) => {
        if (data.payload) {
          setIsLoading(true);
          if (!currentNudge) {
            setIsNudgeVisible(true);
          }
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
      [SocketEvent.AUDIO_STREAM]: () => {
        if (!isAudioActive) {
          setIsAudioActive(true);
        }

        // Clear any existing timeout
        if (audioTimeoutRef.current) {
          clearTimeout(audioTimeoutRef.current);
        }

        // Set new timeout to mark audio as inactive if no new messages come
        audioTimeoutRef.current = setTimeout(() => {
          setIsAudioActive(false);
        }, AUDIO_INACTIVE_TIMEOUT);
      },
    }),
    [currentNudge, handleCallEnd, isAudioActive],
  );

  const {userData} = useUser();
  // Automatically manages socket connection based on screen focus and app state
  const {emitSocketEvent} = useSocketConnection({
    userId: userData?.id || 0,
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
    setIsNudgeVisible(prev => !prev);
  };

  const handlePlayPauseCallPress = useDebounce(
    () => {
      emitSocketEvent(
        isCallPaused
          ? SocketEvent.AUDIO_CHAT_NUDGE_RESUMED
          : SocketEvent.AUDIO_CHAT_NUDGE_PAUSED,
        {chatId: chat?.chatId},
      );
      setIsCallPaused(prev => !prev);
    },
    {delay: 500},
  );

  return (
    <LinearGradient
      colors={[colors.black, colors.navyGray, colors.oceanBlue]}
      style={styles.container}
      locations={[0, 0.65, 0.9]}
      start={{x: 0.4, y: 0}}
      end={{x: 0.6, y: 1}}>
      <StatusBar backgroundColor="transparent" translucent />
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {t('ListeningScreen.takingNotes')}
        </Text>
        <Timer startTime={startTime} />
      </View>

      <View style={styles.content}>
        <View style={styles.blobContainer}>
          <AnimatedBlob
            isExpanded={!isNudgeVisible}
            isCallPaused={isCallPaused}
            isAudioActive={isAudioActive}
            onPlayPauseCallPress={handlePlayPauseCallPress}
          />
        </View>
        <NudgeSection
          isVisible={isNudgeVisible}
          nudge={currentNudge}
          isLoading={isLoading}
          onFeedbackSuccess={handleNudgeFeedbackSuccess}
        />
      </View>

      <ControlButtons
        onFocusModeButtonPress={toggleNudgeVisibility}
        isNudgeVisible={isNudgeVisible}
        showFocusModeButton={!!currentNudge}
        onEndCallSuccess={handleCallEnd}
      />
    </LinearGradient>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: '16@vs',
    marginTop: '40@vs',
  },
  headerText: {
    ...fontFamily.REPLAY_PRO.BOLD,
    ...typography.body.large,
    letterSpacing: 0,
    color: colors.lightCyan,
    marginBottom: '8@vs',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  blobContainer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16@vs',
  },
});
