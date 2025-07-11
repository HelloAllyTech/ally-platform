import React, {useEffect, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {ImageBackground, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import images from '@/assets/images';
import {PrimaryButton} from '@/components';
import {isIOS} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {RootStackScreenProps} from '@/navigation/types';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

import {
  BoxBreathingAnimation,
  BreathingControls,
} from './components/BreathingVideo';
import {Phase} from './components/BreathingVideo/BoxBreathingAnimation';
import {CallEndOverlay} from './components/CallEndOverlay';

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

  useEffect(() => {
    return () => {
      setIsPlaying(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

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

  const onPressSkip = () => {
    setIsPlaying(false);
    navigation.navigate('CallSummary');
  };

  const onPhaseChange = (phase: Phase) => {
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
            <BoxBreathingAnimation
              isPlaying={isPlaying}
              isMuted={isMuted}
              animationDuration={4000}
              onPhaseChange={onPhaseChange}
            />
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
  skipButton: {
    alignSelf: 'center',
    marginBottom: '40@vs',
    width: '30%',
  },
});
