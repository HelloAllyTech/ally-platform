import React, {useEffect, useMemo, useState} from 'react';
import {View, Text, StatusBar, SafeAreaView, BackHandler} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useSocket} from '@/hooks/useSocket';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme/colors';
import {typography} from '@/theme/typography';
import {SocketEvent, SocketMessage} from '@/types/message';

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
  hasFeedback?: boolean;
  feedbackValue?: boolean;
}

interface AudioData {
  type: 'Buffer';
  data: number[];
}

export const ListeningScreen = () => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const [isNudgeVisible, setIsNudgeVisible] = useState(true);
  const chat = useAppSelector(state => state.chat.currentChat);
  const [startTime] = useState(() =>
    chat?.startedAt ? new Date(chat.startedAt).getTime() : Date.now(),
  );
  const [currentNudge, setCurrentNudge] = useState<Nudge | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [audioIntensity, setAudioIntensity] = useState(0);
  const [isCallPaused, setIsCallPaused] = useState(false);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        navigation.navigate('Home');
        return true;
      },
    );

    return () => backHandler.remove();
  }, [navigation]);

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.STAGE]: (data: SocketMessage) => {
        // TO DO: Implement stage event
      },
      [SocketEvent.CHAT_ENDED]: () => {
        // TO DO: Implement chat ended event
      },
      [SocketEvent.NUDGE]: (data: SocketMessage) => {
        if (data.payload) {
          setIsLoading(true);
          // Short delay to show loading state
          setTimeout(() => {
            setCurrentNudge({
              id: data.payload!.id,
              content: data.payload!.content,
              chatId: data.payload!.chatId,
              senderId: data.payload!.senderId,
              createdAt: data.payload!.createdAt,
              hasFeedback: false,
            });
            setIsLoading(false);
          }, 500);
        }
      },
      [SocketEvent.MESSAGE_RECEIVED]: (data: SocketMessage) => {
        // console.log('Message received:', data.payload);
      },
      [SocketEvent.UTTERANCE_ENDED]: (data: SocketMessage) => {
        // TO DO: Implement utterance ended event
      },
      [SocketEvent.USER_JOINED]: () => {
        // TO DO: Implement user joined event
      },
      [SocketEvent.USER_DISCONNECTED]: () => {
        // TO DO: Implement user disconnected event
      },
      [SocketEvent.AUDIO_STREAM]: (data: any) => {
        if (data.payload) {
          // TO DO: Implement audio stream event
        }
      },
    }),
    [],
  );

  const {userData} = useUser();
  const {connect, emitSocketEvent} = useSocket({
    userId: userData?.id || 0,
    eventCallbacks: socketEventCallbacks,
  });

  useEffect(() => {
    connect();
  }, [connect]);

  const handleNudgeFeedback = (isPositive: boolean) => {
    if (currentNudge) {
      setCurrentNudge(prev => {
        if (prev) {
          return {
            ...prev,
            hasFeedback: true,
            feedbackValue: isPositive,
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
        ? SocketEvent.RESUME_AUDIO_CHAT
        : SocketEvent.PAUSE_AUDIO_CHAT,
      {chatId: chat?.chatId},
    );
  };

  return (
    <SafeAreaView style={styles.container}>
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
          <AnimatedBlob
            isExpanded={!isNudgeVisible}
            intensity={0.5}
            isCallPaused={isCallPaused}
            onPlayPauseCallPress={handlePlayPauseCallPress}
          />
          {currentNudge && (
            <NudgeSection
              isVisible={isNudgeVisible}
              nudge={currentNudge}
              isLoading={isLoading}
              onFeedback={handleNudgeFeedback}
            />
          )}
        </View>

        <ControlButtons
          onFocusModeButtonPress={toggleNudgeVisibility}
          isNudgeVisible={isNudgeVisible}
          showFocusModeButton={!!currentNudge}
        />
      </LinearGradient>
    </SafeAreaView>
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
    ...typography.body.large,
    letterSpacing: 0.15,
    color: colors.white,
    opacity: 0.6,
    marginBottom: '8@vs',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nudgeContainer: {
    marginBottom: '78@vs',
    marginTop: '16@vs',
  },
});
