import {useEffect, useRef} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {SCREEN_WIDTH} from '@/constants/general';
import {colors} from '@/theme';

const CONTAINER_WIDTH = SCREEN_WIDTH * 0.75;
const GRADIENT_COLORS = ['transparent', 'rgba(255,255,255,0.5)', 'transparent'];

interface ShimmerItemProps {
  widthPercentage: number;
  height: number;
}

const ShimmerItem = ({widthPercentage, height}: ShimmerItemProps) => {
  const width = (CONTAINER_WIDTH * widthPercentage) / 100;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      }),
    ).start();
  }, [shimmerAnim]);

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View style={[styles.skeleton, {width, height}]}>
      <Animated.View
        style={[StyleSheet.absoluteFill, {transform: [{translateX}]}]}>
        <LinearGradient
          colors={GRADIENT_COLORS}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={[styles.gradient, {width: width * 0.7}]}
        />
      </Animated.View>
    </View>
  );
};

export const SkeletonLoader = () => {
  return (
    <View style={styles.container}>
      <ShimmerItem widthPercentage={100} height={8} />
      <ShimmerItem widthPercentage={90} height={8} />
      <ShimmerItem widthPercentage={70} height={8} />
      <ShimmerItem widthPercentage={80} height={8} />
      <ShimmerItem widthPercentage={90} height={8} />
      <ShimmerItem widthPercentage={90} height={8} />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '10@vs',
    gap: 10,
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.charcoalBlue,
    borderRadius: 6,
    overflow: 'hidden',
  },
  gradient: {
    height: '100%',
  },
});
