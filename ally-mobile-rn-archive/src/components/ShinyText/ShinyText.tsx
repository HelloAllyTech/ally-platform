import React, {useEffect} from 'react';
import MaskedView from '@react-native-masked-view/masked-view';
import {StyleProp, StyleSheet, Text, TextStyle} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

interface ShinyTextProps {
  children: React.ReactNode;
  disabled?: boolean;
  speed?: number; // in seconds
  style?: StyleProp<TextStyle>;
}

const GRADIENT_WIDTH = 300;
const ANIMATION_DISTANCE = 300;
const GRADIENT_COLORS = [
  'rgba(255,255,255,0)',
  'rgba(255,255,255,0.8)',
  'rgba(255,255,255,0)',
];

export const ShinyText: React.FC<ShinyTextProps> = ({
  children,
  disabled = false,
  speed = 5,
  style,
}) => {
  const translateX = useSharedValue(-GRADIENT_WIDTH);

  useEffect(() => {
    if (!disabled) {
      translateX.value = withRepeat(
        withTiming(ANIMATION_DISTANCE, {
          duration: speed * 500,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    } else {
      translateX.value = -GRADIENT_WIDTH;
    }
  }, [disabled, speed, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{translateX: disabled ? 0 : translateX.value}],
  }));

  return (
    <MaskedView
      maskElement={<Text style={[styles.text, style]}>{children}</Text>}>
      <Text style={[styles.text, style]}>{children}</Text>
      {!disabled && (
        <Animated.View
          style={[StyleSheet.absoluteFill, animatedStyle]}
          pointerEvents="none">
          <LinearGradient
            colors={GRADIENT_COLORS}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 0}}
            style={[
              {
                width: GRADIENT_WIDTH,
              },
              styles.gradient,
            ]}
          />
        </Animated.View>
      )}
    </MaskedView>
  );
};

const styles = ScaledSheet.create({
  text: {
    color: '#000',
    fontSize: '16@s',
  },
  gradient: {
    height: '100%',
  },
});
