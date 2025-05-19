import {useCallback, useMemo, useState} from 'react';
import {StatusBar, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
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

interface AudioData {
  type: 'Buffer';
  data: number[];
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
  const [audioIntensity, setAudioIntensity] = useState(0);
  const [isCallPaused, setIsCallPaused] = useState(false);

  const handleCallEnd = useCallback(() => {
    dispatch(clearCurrentChat());
    navigation.navigate('CallSummary');
  }, [dispatch, navigation]);

  useHardwareBackPressHandler(() => {
    handleCallEnd();
    return true;
  });

  // TO DO: Remove unwanted events
  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.STAGE]: (data: SocketMessage) => {},
      [SocketEvent.CHAT_ACCEPTED]: (data: SocketMessage) => {},
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
      [SocketEvent.MESSAGE_RECEIVED]: () => {},
      [SocketEvent.AUDIO_CHAT_MUTED]: () => {},
      [SocketEvent.ICE_CANDIDATE]: () => {},
      [SocketEvent.WEBRTC_OFFER]: () => {},
      [SocketEvent.WEBRTC_ANSWER]: () => {},
      [SocketEvent.AUDIO_MESSAGE]: () => {},
      [SocketEvent.START_AUDIO_CHAT]: () => {},
      [SocketEvent.UTTERANCE_ENDED]: () => {},
      [SocketEvent.USER_JOINED]: () => {},
      [SocketEvent.USER_DISCONNECTED]: () => {},
      [SocketEvent.AUDIO_STREAM]: () => {},
      [SocketEvent.AUDIO_CHAT_NUDGE_PAUSED]: () => {},
      [SocketEvent.AUDIO_CHAT_NUDGE_RESUMED]: () => {},
    }),
    [currentNudge, handleCallEnd],
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

  const handlePlayPauseCallPress = () => {
    emitSocketEvent(
      isCallPaused
        ? SocketEvent.AUDIO_CHAT_NUDGE_RESUMED
        : SocketEvent.AUDIO_CHAT_NUDGE_PAUSED,
      {chatId: chat?.chatId},
    );
    setIsCallPaused(prev => !prev);
  };

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
            intensity={0.5}
            isCallPaused={isCallPaused}
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
