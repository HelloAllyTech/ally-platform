import React, {useEffect, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {ImageBackground, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import images from '@/assets/images';
import {PrimaryButton} from '@/components';
import useTranslate from '@/hooks/useTranslate';
import {RootStackScreenProps} from '@/navigation/types';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

import {
  BoxBreathingLottie,
  BreathingControls,
} from './components/BreathingVideo';
import {CallEndOverlay} from './components/CallEndOverlay';

export const BreathingScreen: React.FC<
  RootStackScreenProps<'BreathingScreen'>
> = ({navigation}) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [seconds, setSeconds] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lottieRef = useRef<LottieView>(null); // <-- Add ref for Lottie
  const [showOverlay, setShowOverlay] = useState(true);
  const {t} = useTranslate();

  useEffect(() => {
    if (showOverlay) {
      const timer = setTimeout(() => {
        setShowOverlay(false);
      }, 3000);
      return () => clearTimeout(timer);
    } else {
      startTimer();
      playVideo();
    }
  }, [showOverlay]);

  const startTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setSeconds(prev => (prev === 4 ? 1 : prev + 1));
    }, 1000);
  };

  const stopTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      stopTimer();
      lottieRef.current?.pause();
    } else {
      startTimer();
      lottieRef.current?.play();
    }
    setIsPlaying(prev => !prev);
  };

  const toggleMute = () => {
    // Mute doesn't affect Lottie, but keep it if you're adding audio/video later
    setIsMuted(prev => !prev);
  };

  const playVideo = () => {
    lottieRef.current?.play();
  };

  const onPressSkip = () => {
    navigation.navigate('CallSummary');
  };

  return (
    <>
      {showOverlay ? (
        <CallEndOverlay />
      ) : (
        <ImageBackground
          source={images.breathingBackground}
          style={styles.container}
          resizeMode="cover">
          <LinearGradient
            colors={[colors.darkGray, colors.black0]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.content}>
            <Text style={styles.heading}>
              {t('BreathingScreen.header.box')}{' '}
              <Text style={styles.headingItalic}>
                {t('BreathingScreen.header.breathing')}
              </Text>
            </Text>

            <BoxBreathingLottie ref={lottieRef} />

            <Text style={styles.timer}>{seconds}</Text>

            <BreathingControls
              isMuted={isMuted}
              isPlaying={isPlaying}
              onToggleMute={toggleMute}
              onTogglePlayPause={togglePlayPause}
            />
          </View>

          <PrimaryButton
            label={t('BreathingScreen.skip')}
            onPress={onPressSkip}
            customContainerStyle={styles.skipButton}
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
    paddingTop: '60@vs',
  },
  heading: {
    color: colors.white,
    fontSize: '32@ms',
    ...fontFamily.REPLAY_PRO.HEADLINE,
    marginBottom: '20@vs',
  },
  headingItalic: {
    fontStyle: 'italic',
  },
  timer: {
    fontSize: '48@ms',
    color: colors.white,
    fontWeight: 'bold',
    marginBottom: '12@vs',
    ...fontFamily.ROBOTO.REGULAR,
  },
  skipButton: {
    alignSelf: 'center',
    marginBottom: '40@vs',
    width: '30%',
  },
});
