import React, {useEffect, useRef} from 'react';
import {Animated, Easing, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Svg, {Circle} from 'react-native-svg';

import {colors} from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface CircularProgressProps {
  progress: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  progressColor?: string;
  trackColor?: string;
  animationDuration?: number;
  children?: React.ReactNode;
}

/**
 * CircularProgress Component
 *
 * A reusable circular progress indicator using SVG.
 * Displays progress as a partial circle arc with optional center content.
 * Animates from 0 to the target progress on mount and when progress changes.
 */
export const CircularProgress: React.FC<CircularProgressProps> = ({
  progress,
  max = 100,
  size = 32,
  strokeWidth = 3,
  progressColor = colors.blue,
  trackColor = colors.ds.grey[100],
  animationDuration = 1200,
  children,
}) => {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progressPercentage = Math.min(Math.max(progress / max, 0), 1);
  const targetOffset = circumference * (1 - progressPercentage);

  const animatedOffset = useRef(new Animated.Value(circumference)).current;

  useEffect(() => {
    animatedOffset.setValue(circumference);
    Animated.timing(animatedOffset, {
      toValue: targetOffset,
      duration: animationDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [targetOffset, circumference, animationDuration, animatedOffset]);

  return (
    <View style={[styles.container, {width: size, height: size}]}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {progressPercentage > 0 && (
          <AnimatedCircle
            cx={center}
            cy={center}
            r={radius}
            stroke={progressColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={animatedOffset}
            strokeLinecap="round"
            rotation="-90"
            origin={`${center}, ${center}`}
          />
        )}
      </Svg>
      {children && <View style={styles.childrenContainer}>{children}</View>}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  childrenContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
