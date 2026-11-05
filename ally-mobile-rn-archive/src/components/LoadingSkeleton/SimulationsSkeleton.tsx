import React, {useEffect, useMemo} from 'react';
import {Animated, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, radius} from '@/theme';

interface SimulationsSkeletonProps {
  count?: number;
}

export const SimulationsSkeleton: React.FC<SimulationsSkeletonProps> = ({
  count = 3,
}) => {
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

  const renderSkeletonCard = () => (
    <View style={styles.card}>
      {/* Image skeleton */}
      <View style={styles.coverSkeleton}>
        <Animated.View style={[styles.shimmer, shimmerStyle]} />
      </View>

      {/* Content skeleton */}
      <View style={styles.cardBody}>
        {/* Title skeleton */}
        <View style={styles.titleSkeleton}>
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
        <View style={styles.titleSkeletonShort}>
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {Array.from({length: count}, (_, index) => (
        <View key={index}>{renderSkeletonCard()}</View>
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '10@ms',
    paddingBottom: '90@ms',
    gap: '12@ms',
  },
  card: {
    flexDirection: 'column',
    backgroundColor: colors.white,
    borderColor: colors.ds.stroke.primary,
    borderWidth: 0.5,
    borderRadius: radius.xl3,
    shadowColor: colors.ds.grey[900],
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 1,
    overflow: 'hidden',
    paddingTop: '8@ms',
    paddingBottom: '16@ms',
    marginHorizontal: '2@ms',
  },
  coverSkeleton: {
    minHeight: '180@ms',
    backgroundColor: colors.ds.grey[100],
    borderRadius: '16@ms',
    marginBottom: '8@ms',
    marginHorizontal: '8@ms',
    overflow: 'hidden',
  },
  cardBody: {
    marginHorizontal: '18@ms',
    flexDirection: 'column',
  },
  titleSkeleton: {
    height: '20@ms',
    width: '80%',
    backgroundColor: colors.ds.grey[100],
    borderRadius: '4@ms',
    marginBottom: '4@ms',
    overflow: 'hidden',
  },
  titleSkeletonShort: {
    height: '20@ms',
    width: '60%',
    backgroundColor: colors.ds.grey[100],
    borderRadius: '4@ms',
    marginBottom: '8@ms',
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.ds.whiteAlpha[500],
  },
});
