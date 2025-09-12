import React, {useEffect, useMemo} from 'react';
import {Animated, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

interface LinearLoaderProps {
  height?: number;
  width?: string | number;
  color?: string;
  backgroundColor?: string;
  borderRadius?: number;
  style?: any;
  gradientColors?: string[];
  useColorGradient?: boolean;
}

export const LinearLoader: React.FC<LinearLoaderProps> = ({
  height = 4,
  width = '100%',
  color = colors.ashGray,
  backgroundColor = colors.lightGray8,
  borderRadius = 2,
  style,
  useColorGradient = false,
  gradientColors,
}) => {
  const defaultGradientColors = useColorGradient
    ? [
        `${color}00`, // 0% opacity
        `${color}40`, // 25% opacity
        `${color}80`, // 50% opacity
        `${color}40`, // 25% opacity
        `${color}00`, // 0% opacity
      ]
    : [
        'rgba(255, 255, 255, 0)',
        'rgba(255, 255, 255, 0.2)',
        'rgba(255, 255, 255, 0.6)',
        'rgba(255, 255, 255, 0.2)',
        'rgba(255, 255, 255, 0)',
      ];

  const finalGradientColors = gradientColors || defaultGradientColors;
  const shimmerAnimation = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const startAnimation = () => {
      Animated.loop(
        Animated.timing(shimmerAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ).start();
    };

    startAnimation();
  }, [shimmerAnimation]);

  const translateX = shimmerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View
      style={[
        styles.container,
        {height, width, backgroundColor, borderRadius},
        style,
      ]}>
      <Animated.View
        style={[
          styles.gradientContainer,
          {
            transform: [{translateX}],
          },
        ]}>
        <LinearGradient
          colors={finalGradientColors}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={[styles.gradient, {height, borderRadius}]}
        />
      </Animated.View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  gradientContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '200%',
  },
  gradient: {
    width: '100%',
  },
});
