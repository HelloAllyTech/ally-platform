import {useCallback, useEffect, useRef, useState} from 'react';
import {Animated as RNAnimated, StyleSheet, Text, View} from 'react-native';
import {useSharedValue, withTiming} from 'react-native-reanimated';
import SoundPlayer from 'react-native-sound-player';

import {sounds} from '@/assets';
import {SCREEN_WIDTH} from '@/constants/general';
import {useTranslate} from '@/hooks/useTranslate';
import type {TranslationType} from '@/localization/locales/type';
import {colors} from '@/theme';

import {FlowerPetal} from './FlowerPetal';

export interface Phase {
  time: number;
  name: string;
  label: TranslationType;
  dotSize: number;
  position: {
    top: number;
    left: number;
  };
  flowerPos: {
    top: number;
    left: number;
  };
}

interface Position {
  top: number;
  left: number;
}

interface BoxBreathingAnimationProps {
  isMuted: boolean;
  isPlaying: boolean;
  animationDuration?: number;
  onPhaseChange?: (phase: Phase) => void;
  testID?: string;
}

const phases: Phase[] = [
  {
    time: 4,
    name: 'one',
    label: 'boxBreathing.phaseHold',
    dotSize: 14,
    position: {top: 0, left: 0},
    flowerPos: {top: 0.2, left: 0.5},
  },
  {
    time: 1,
    name: 'two',
    label: 'boxBreathing.phaseInhale',
    dotSize: 14,
    position: {top: 0, left: 1},
    flowerPos: {top: 0.2, left: 0.5},
  },
  {
    time: 2,
    name: 'three',
    label: 'boxBreathing.phaseHold',
    dotSize: 14,
    position: {top: 1, left: 1},
    flowerPos: {top: 0.2, left: 0.5},
  },
  {
    time: 3,
    name: 'four',
    label: 'boxBreathing.phaseExhale',
    dotSize: 14,
    position: {top: 1, left: 0},
    flowerPos: {top: 0.2, left: 0.5},
  },
];

export const BoxBreathingAnimation = ({
  isMuted = false,
  isPlaying,
  onPhaseChange,
  animationDuration = 4000,
}: BoxBreathingAnimationProps) => {
  const {t} = useTranslate();
  const [phaseIndex, setPhaseIndex] = useState(0);
  // Use animated value directly for bloom instead of setState-per-frame
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  const dotSize = 14;
  const dotOffset = dotSize * 0.5;

  const squareSize = Math.min(SCREEN_WIDTH * 0.8, 350);

  // Animated values
  const dotPosition = useRef(
    new RNAnimated.ValueXY({
      x: -squareSize * 0.5,
      y: -squareSize * 0.5,
    }),
  ).current;
  const bloomProgress = useSharedValue(0);

  // Refs for intervals
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize track player
  useEffect(() => {
    const setup = async () => {
      // Enable mix with others so audio doesn't interfere with microphone
      SoundPlayer.setMixAudio(true);
      SoundPlayer.playAsset(sounds.breath);
      setIsPlayerReady(true);
    };
    setup();
    return () => {
      SoundPlayer.stop();
      // Reset mix audio setting
      SoundPlayer.setMixAudio(false);
    };
  }, []);

  // Handle music playback
  useEffect(() => {
    const handlePlayback = async () => {
      if (!isPlayerReady) return;

      if (isPlaying) {
        await SoundPlayer.seek(0);
        await SoundPlayer.play();
      } else {
        await SoundPlayer.pause();
      }
    };

    handlePlayback();
  }, [isPlaying, isPlayerReady]);

  // Convert relative positions to absolute coordinates
  const getAbsolutePosition = useCallback(
    (relativePos: Position) => ({
      x: relativePos.left * squareSize - squareSize * 0.5,
      y: relativePos.top * squareSize - squareSize * 0.5,
    }),
    [squareSize],
  );

  useEffect(() => {
    onPhaseChange?.(phases[phaseIndex]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseIndex]);

  // Handle phase transitions
  useEffect(() => {
    if (isPlaying) {
      const updatePhase = () => {
        setPhaseIndex(prev => {
          const next = (prev + 1) % phases.length;
          return next;
        });
      };

      // Initial phase setup
      updatePhase();

      // Set up phase interval
      intervalRef.current = setInterval(updatePhase, animationDuration);
    }

    return () => {
      const intervalId = intervalRef.current;
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPlaying, animationDuration]);

  useEffect(() => {
    if (phaseIndex === 1 && !isMuted && isPlayerReady) {
      SoundPlayer.seek(0);
      SoundPlayer.play();
    }
  }, [isMuted, phaseIndex, isPlayerReady]);

  // Animate dot movement
  useEffect(() => {
    if (isPlaying) {
      const currentPhase = phases[phaseIndex];
      const targetPos = getAbsolutePosition(currentPhase.position);

      RNAnimated.timing(dotPosition, {
        toValue: targetPos,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    } else {
      // Reset dot position to initial position when stopped
      dotPosition.setValue({
        x: -(squareSize * 0.5),
        y: -(squareSize * 0.5),
      });
      bloomProgress.value = 0;
      setPhaseIndex(0);
      // no-op for reanimated value
    }
  }, [
    squareSize,
    dotOffset,
    bloomProgress,
    phaseIndex,
    isPlaying,
    dotPosition,
    animationDuration,
    getAbsolutePosition,
  ]);

  // Animate flower blooming
  useEffect(() => {
    if (isPlaying) {
      const currentPhase = phases[phaseIndex];
      let targetBloom = 0;

      if (currentPhase.name === 'one') {
        targetBloom = 0;
      } else if (currentPhase.name === 'two') {
        targetBloom = 1;
      } else if (currentPhase.name === 'three') {
        targetBloom = 1;
      } else if (currentPhase.name === 'four') {
        targetBloom = 0;
      }

      bloomProgress.value = withTiming(targetBloom, {
        duration: animationDuration,
      });
    }
  }, [phaseIndex, isPlaying, bloomProgress, animationDuration]);

  useEffect(() => {
    SoundPlayer.setVolume(isMuted ? 0 : 1);
  }, [isMuted]);

  // No setState listener — we pass animated value directly to petals

  return (
    <View style={styles.container} testID="box-breathing-container">
      <View style={[styles.square, {width: squareSize, height: squareSize}]}>
        {/* Animated dot */}
        <RNAnimated.View
          testID="animated-dot"
          style={[
            styles.dot,
            {
              transform: [
                {translateX: dotPosition.x},
                {translateY: dotPosition.y},
              ],
              width: dotSize,
              height: dotSize,
            },
          ]}
        />

        {/* Flower in center */}
        <View style={styles.flowerContainer}>
          <Text style={styles.flowerText}>{t(phases[phaseIndex].label)}</Text>

          <FlowerPetal
            bloomProgress={bloomProgress}
            size={Math.min(squareSize * 0.8, 280)}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  square: {
    borderWidth: 2,
    borderColor: '#555',
    borderRadius: 16,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    borderRadius: 50,
    boxShadow: '0 0 8px rgba(255, 255, 255, 0.5)',
  },
  flowerContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '90%',
  },
  flowerText: {
    fontSize: 18,
    color: colors.white,
    fontWeight: '600',
    marginTop: 60,
  },
});
