import React, {useEffect, useMemo} from 'react';
import {Animated, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

export const LoadingSkeleton: React.FC = () => {
  const shimmerAnimation = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const startShimmerAnimation = () => {
      Animated.sequence([
        Animated.timing(shimmerAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnimation, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => startShimmerAnimation());
    };

    startShimmerAnimation();
  }, [shimmerAnimation]);

  const translateX = shimmerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  const shimmerStyle = {
    transform: [{translateX}],
  };

  return (
    <>
      <View style={styles.card}>
        <View style={styles.skeletonTitle}>
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
        <View style={styles.skeletonBar}>
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={styles.skeletonLegendColor}>
              <Animated.View style={[styles.shimmer, shimmerStyle]} />
            </View>
            <View style={styles.skeletonLegendText}>
              <Animated.View style={[styles.shimmer, shimmerStyle]} />
            </View>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.skeletonLegendColor}>
              <Animated.View style={[styles.shimmer, shimmerStyle]} />
            </View>
            <View style={styles.skeletonLegendText}>
              <Animated.View style={[styles.shimmer, shimmerStyle]} />
            </View>
          </View>
        </View>
      </View>
    </>
  );
};

const styles = ScaledSheet.create({
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: '12@s',
    padding: '18@s',
    marginBottom: '18@s',
    borderWidth: 0.5,
    borderColor: colors.lightGray7,
    overflow: 'hidden',
  },
  skeletonTitle: {
    height: '20@s',
    width: '60%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@s',
    marginBottom: '20@s',
    overflow: 'hidden',
  },
  skeletonBar: {
    height: '36@s',
    width: '100%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@s',
    marginBottom: '16@s',
    overflow: 'hidden',
  },
  legendRow: {
    flexDirection: 'row',
    gap: '18@s',
    marginTop: '2@s',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@s',
  },
  skeletonLegendColor: {
    width: '18@s',
    height: '18@s',
    borderRadius: '4@s',
    backgroundColor: colors.lightGray8,
    overflow: 'hidden',
  },
  skeletonLegendText: {
    width: '60@s',
    height: '12@s',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@s',
    overflow: 'hidden',
  },
  skeletonQuestions: {
    height: '36@s',
    width: '40%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@s',
    marginBottom: '4@s',
    overflow: 'hidden',
  },
  skeletonDesc: {
    height: '20@s',
    width: '80%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@s',
    marginTop: '6@s',
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
});
