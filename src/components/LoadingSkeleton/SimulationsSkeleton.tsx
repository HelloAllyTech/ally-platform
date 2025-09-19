import React, {useEffect, useMemo} from 'react';
import {Animated, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

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

        {/* Description skeleton */}
        <View style={styles.descSkeleton}>
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
        <View style={styles.descSkeletonMedium}>
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
        </View>
        <View style={styles.descSkeletonShort}>
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
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderColor: colors.lightGray5,
    borderRadius: '8@ms',
    width: '100%',
    shadowColor: colors.darkGray12,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  coverSkeleton: {
    width: '35%',
    minWidth: '130@ms',
    height: '120@ms',
    borderTopLeftRadius: '8@ms',
    borderBottomLeftRadius: '8@ms',
    backgroundColor: colors.lightGray4,
    overflow: 'hidden',
  },
  cardBody: {
    margin: '12@ms',
    width: '55%',
    flexDirection: 'column',
    justifyContent: 'center',
  },
  titleSkeleton: {
    height: '18@ms',
    width: '90%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
    marginBottom: '4@ms',
    overflow: 'hidden',
  },
  titleSkeletonShort: {
    height: '18@ms',
    width: '60%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
    marginBottom: '6@ms',
    overflow: 'hidden',
  },
  descSkeleton: {
    height: '12@ms',
    width: '100%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
    marginBottom: '4@ms',
    overflow: 'hidden',
  },
  descSkeletonMedium: {
    height: '12@ms',
    width: '85%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
    marginBottom: '4@ms',
    overflow: 'hidden',
  },
  descSkeletonShort: {
    height: '12@ms',
    width: '70%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
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
