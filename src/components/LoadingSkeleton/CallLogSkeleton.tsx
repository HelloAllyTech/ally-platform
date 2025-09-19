import React, {useEffect, useMemo} from 'react';
import {Animated, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

interface CallLogSkeletonProps {
  count?: number;
}

export const CallLogSkeleton: React.FC<CallLogSkeletonProps> = ({
  count = 5,
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

  const renderSkeletonItem = () => (
    <View style={styles.logItemContainer}>
      {/* Header section */}
      <View style={styles.logHeader}>
        <View style={styles.leftContainer}>
          <View style={styles.logHeaderContent}>
            {/* Arrow skeleton */}
            <View style={styles.arrowContainer}>
              <View style={styles.arrowSkeleton}>
                <Animated.View style={[styles.shimmer, shimmerStyle]} />
              </View>
            </View>

            {/* Title and status row */}
            <View style={styles.titleRow}>
              {/* Title skeleton */}
              <View style={styles.titleSkeleton}>
                <Animated.View style={[styles.shimmer, shimmerStyle]} />
              </View>

              {/* Status badge skeleton */}
              <View style={styles.statusContainer}>
                <View style={styles.statusDotSkeleton}>
                  <Animated.View style={[styles.shimmer, shimmerStyle]} />
                </View>
                <View style={styles.statusTextSkeleton}>
                  <Animated.View style={[styles.shimmer, shimmerStyle]} />
                </View>
              </View>

              {/* Eye icon skeleton */}
              <View style={styles.eyeIconSkeleton}>
                <Animated.View style={[styles.shimmer, shimmerStyle]} />
              </View>
            </View>
          </View>

          {/* Date skeleton */}
          <View style={styles.dateSkeleton}>
            <Animated.View style={[styles.shimmer, shimmerStyle]} />
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {Array.from({length: count}, (_, index) => (
        <View key={index}>{renderSkeletonItem()}</View>
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  logItemContainer: {
    backgroundColor: colors.white,
    marginHorizontal: '14@ms',
    paddingHorizontal: '10@ms',
    paddingVertical: '10@ms',
    borderBottomWidth: 1,
    borderColor: colors.lightGray2,
  },
  leftContainer: {
    flex: 1,
    marginRight: '10@ms',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: '12@ms',
    padding: '8@ms',
    marginTop: '-2@ms',
    marginBottom: '2@ms',
  },
  logHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  arrowContainer: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4@ms',
  },
  arrowSkeleton: {
    width: '16@ms',
    height: '16@ms',
    backgroundColor: colors.lightGray8,
    borderRadius: '2@ms',
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  titleSkeleton: {
    height: '14@ms',
    width: '60%',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
    marginRight: '8@ms',
    overflow: 'hidden',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '8@ms',
    paddingVertical: '4@vs',
    borderRadius: '12@ms',
    gap: '4@vs',
    backgroundColor: colors.lightGray8,
    overflow: 'hidden',
  },
  statusDotSkeleton: {
    width: '4@vs',
    height: '4@vs',
    borderRadius: '2@vs',
    backgroundColor: colors.lightGray6,
    overflow: 'hidden',
  },
  statusTextSkeleton: {
    width: '30@ms',
    height: '8@ms',
    backgroundColor: colors.lightGray6,
    borderRadius: '2@ms',
    overflow: 'hidden',
  },
  eyeIconSkeleton: {
    width: '16@ms',
    height: '16@ms',
    backgroundColor: colors.lightGray8,
    borderRadius: '2@ms',
    marginLeft: '10@ms',
    overflow: 'hidden',
  },
  dateSkeleton: {
    height: '12@ms',
    width: '120@ms',
    backgroundColor: colors.lightGray8,
    borderRadius: '4@ms',
    marginLeft: '30@ms',
    marginTop: '4@ms',
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
