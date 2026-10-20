import React, {useCallback, useEffect, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {SCREEN_WIDTH} from '@/constants/general';
import {useTranslate} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {colors, fontFamily, typography} from '@/theme';

export const BreathingExerciseScreen: React.FC<
  RootStackScreenProps<'BreathingExercise'>
> = ({navigation, route}) => {
  const {t} = useTranslate();
  const {config} = route.params;

  const [currentCycle, setCurrentCycle] = useState(1);
  const [phase, setPhase] = useState<
    'inhale' | 'holdIn' | 'exhale' | 'holdOut'
  >('inhale');

  const squareSize = Math.min(SCREEN_WIDTH * 0.8, ms(300));
  const dotSize = ms(20);

  const dotX = useSharedValue(0);
  const dotY = useSharedValue(0);

  const dotStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {translateX: dotX.value - dotSize / 2},
        {translateY: dotY.value - dotSize / 2},
      ],
    };
  });

  const runPhase = useCallback(
    (
      currentPhase: 'inhale' | 'holdIn' | 'exhale' | 'holdOut',
      cycle: number,
    ) => {
      if (cycle > config.cycles) {
        // We could auto-exit here, but requirement R2 says exit on button click.
        // The animation will just loop or stay finished.
        // Let's just stop or restart? PRD says "The learner should be able to leave at any point".
        // It doesn't explicitly say what happens when all cycles finish.
        // Usually it should probably show a "Finished" state or just keep looping.
        // Let's keep it simple and loop if they don't exit, or stop.
        return;
      }

      setPhase(currentPhase);

      let targetX = 0;
      let targetY = 0;
      let duration = 0;
      let nextPhase: 'inhale' | 'holdIn' | 'exhale' | 'holdOut' = 'inhale';
      let nextCycle = cycle;

      switch (currentPhase) {
        case 'inhale':
          targetX = squareSize;
          targetY = 0;
          duration = config.inhale * 1000;
          nextPhase = 'holdIn';
          break;
        case 'holdIn':
          targetX = squareSize;
          targetY = squareSize;
          duration = config.holdIn * 1000;
          nextPhase = 'exhale';
          break;
        case 'exhale':
          targetX = 0;
          targetY = squareSize;
          duration = config.exhale * 1000;
          nextPhase = 'holdOut';
          break;
        case 'holdOut':
          targetX = 0;
          targetY = 0;
          duration = config.holdOut * 1000;
          nextPhase = 'inhale';
          nextCycle = cycle + 1;
          break;
      }

      dotX.value = withTiming(targetX, {
        duration,
        easing: Easing.linear,
      });
      dotY.value = withTiming(
        targetY,
        {
          duration,
          easing: Easing.linear,
        },
        finished => {
          if (finished) {
            runOnJS(setCurrentCycle)(nextCycle);
            runOnJS(runPhase)(nextPhase, nextCycle);
          }
        },
      );
    },
    [config, squareSize, dotX, dotY],
  );

  useEffect(() => {
    runPhase('inhale', 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExit = useCallback(() => {
    // R2: Clicking 'Exit' must immediately end the activity and return the learner to the course.
    navigation.goBack();
  }, [navigation]);

  const getInstructionText = () => {
    switch (phase) {
      case 'inhale':
        return config.inhaleText;
      case 'holdIn':
        return config.holdInText;
      case 'exhale':
        return config.exhaleText;
      case 'holdOut':
        return config.holdOutText;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.exitButton} onPress={handleExit}>
          <Text style={styles.exitText}>{t('courses.player.exit')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.instruction}>{getInstructionText()}</Text>

        <View
          style={[styles.square, {width: squareSize, height: squareSize}]}
          testID="breathing-square">
          <Animated.View
            style={[styles.dot, dotStyle]}
            testID="breathing-dot"
          />
        </View>

        <Text style={styles.cycleCount}>
          {t('courses.breathing.cycleProgress', {
            current: Math.min(currentCycle, config.cycles),
            total: config.cycles,
          })}
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  header: {
    paddingHorizontal: '16@ms',
    paddingVertical: '8@ms',
    alignItems: 'flex-end',
  },
  exitButton: {
    padding: '8@ms',
  },
  exitText: {
    ...typography.body.large,
    color: colors.ds.theme.primary,
    fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '40@ms',
  },
  instruction: {
    ...typography.display.small,
    textAlign: 'center',
    paddingHorizontal: '24@ms',
    color: colors.ds.typography.highEmphasis,
    fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily,
  },
  square: {
    borderWidth: 2,
    borderColor: colors.ds.stroke.lightGray,
    borderRadius: '16@ms',
  },
  dot: {
    position: 'absolute',
    width: '20@ms',
    height: '20@ms',
    borderRadius: '10@ms',
    backgroundColor: colors.ds.theme.primary,
  },
  cycleCount: {
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
});
