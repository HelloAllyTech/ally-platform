import React, {useEffect, useRef} from 'react';
import {Animated, Easing, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

const BAR_COUNT = 3;
const STAGGER_DELAY = 100;
const ANIMATION_DURATION = 1000;

interface SpeakingIndicatorProps {
  isSpeaking: boolean;
}

export const SpeakingIndicator: React.FC<SpeakingIndicatorProps> = ({
  isSpeaking,
}) => {
  // Create refs for each bar's animated value (height scale or similar)
  const animations = useRef(
    Array.from({length: BAR_COUNT}, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    if (isSpeaking) {
      const loops = animations.map((anim, index) => {
        const sequence = Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: ANIMATION_DURATION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: ANIMATION_DURATION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]);

        // Delay start based on index
        const delayed = Animated.sequence([
          Animated.delay(index * STAGGER_DELAY),
          Animated.loop(sequence),
        ]);

        return delayed;
      });

      // Start all
      Animated.parallel(loops).start();
    } else {
      // Reset to initial state (muted look) - Show 3 dots (small bars)
      animations.forEach(anim => {
        anim.stopAnimation();
        Animated.timing(anim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }).start();
      });
    }
  }, [isSpeaking, animations]);

  return (
    <View style={styles.container}>
      {animations.map((anim, index) => {
        const height = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [4, 12],
        });

        return (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                height,
                backgroundColor: colors.white,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '16@ms',
    width: '16@ms',
    gap: '3@ms',
  },
  bar: {
    width: '3@ms',
    borderRadius: '1.5@ms',
  },
});
