import React, {useEffect, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {AppState, ImageBackground, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {breathingBackground} from '@/assets';
import {Button} from '@/components';
import {isIOS, SCREEN_NAMES} from '@/constants';
import {useHardwareBackPressHandler, useTranslate} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {useAppDispatch} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {colors, fontFamily} from '@/theme';

import {
  BoxBreathingAnimation,
  BreathingControls,
  CallEndOverlay,
} from './components';

export const BreathingScreen: React.FC<RootStackScreenProps<'Breathing'>> = ({
  navigation,
}) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [seconds, setSeconds] = useState(1);
  const lottieRef = useRef<LottieView>(null); // <-- Add ref for Lottie
  const [showOverlay, setShowOverlay] = useState(true);
  const {t} = useTranslate();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const dispatch = useAppDispatch();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'inactive') {
        setIsPlaying(false);
      }
    });
    return () => {
      setIsPlaying(false);
      subscription.remove();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useHardwareBackPressHandler(() => {
    dispatch(clearCurrentChat());
    setIsPlaying(false);
    navigation.reset({index: 0, routes: [{name: SCREEN_NAMES.CALL_LOG}]});
    return true;
  });

  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setSeconds(1);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (showOverlay) {
      const timer = setTimeout(() => {
        setShowOverlay(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else {
      playVideo();
    }
  }, [showOverlay]);

  const togglePlayPause = () => {
    setIsPlaying(prev => !prev);
  };

  const toggleMute = () => {
    // Mute doesn't affect Lottie, but keep it if you're adding audio/video later
    setIsMuted(prev => !prev);
  };

  const playVideo = () => {
    lottieRef.current?.play();
  };

  const onPressViewSessionSummary = () => {
    setIsPlaying(false);
    navigation.navigate(SCREEN_NAMES.CALL_SUMMARY);
  };

  const onPhaseChange = () => {
    // Only start timer if isPlaying is true
    if (!isPlaying) {
      return;
    }
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setSeconds(1);
    let count = 1;
    timerRef.current = setInterval(() => {
      count += 1;
      if (count > 4) {
        // You can use phase.time if you want to use the phase's duration
        clearInterval(timerRef.current!);
        return;
      }
      setSeconds(count);
    }, 1000);
  };

  return (
    <>
      {showOverlay ? (
        <CallEndOverlay />
      ) : (
        <ImageBackground
          source={breathingBackground}
          style={styles.container}
          resizeMode="cover">
          <LinearGradient
            colors={[colors.darkGray, colors.black0]}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={styles.heading}>{t('stressBuster.returnToSelf')} </Text>
          <View style={styles.content}>
            <BoxBreathingAnimation
              testID="box-breathing-animation"
              isPlaying={isPlaying}
              isMuted={isMuted}
              animationDuration={4000}
              onPhaseChange={onPhaseChange}
            />
            <Text style={styles.timer}>{seconds}</Text>

            <BreathingControls
              testID="breathing-controls"
              isMuted={isMuted}
              isPlaying={isPlaying}
              onToggleMute={toggleMute}
              onTogglePlayPause={togglePlayPause}
            />
          </View>

          <Button
            label={t('stressBuster.viewCallSummary')}
            onPress={onPressViewSessionSummary}
            customContainerStyle={styles.viewSummaryButton}
          />
        </ImageBackground>
      )}
    </>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    textAlign: 'center',
    color: colors.white,
    fontSize: '32@ms',
    ...fontFamily.REPLAY_PRO.HEADLINE,
    marginBottom: '20@vs',
    paddingHorizontal: '20@s',
    marginTop: '60@vs',
  },
  headingItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  timer: {
    fontSize: '48@ms',
    color: colors.white,
    fontWeight: 'bold',
    marginBottom: '12@vs',
    ...fontFamily.ROBOTO.REGULAR,
  },
  viewSummaryButton: {
    alignSelf: 'center',
    marginBottom: '40@vs',
    width: '70%',
  },
});
