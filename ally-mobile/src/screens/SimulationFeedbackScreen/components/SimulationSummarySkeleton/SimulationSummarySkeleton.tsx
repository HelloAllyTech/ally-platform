import React, {useEffect, useRef} from 'react';
import {Animated, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

interface SimulationSummarySkeletonProps {
  isLoading?: boolean;
}

export const SimulationSummarySkeleton: React.FC<
  SimulationSummarySkeletonProps
> = ({isLoading = true}) => {
  const shimmerAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      const shimmer = Animated.loop(
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
        ]),
      );
      shimmer.start();

      return () => shimmer.stop();
    }
  }, [isLoading, shimmerAnimation]);

  const shimmerStyle = {
    opacity: shimmerAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 0.7],
    }),
  };

  const renderSkeletonMetricCard = () => (
    <View style={styles.metricCard}>
      <View style={[styles.skeletonLine, styles.metricLabelSkeleton]} />
      <View style={[styles.skeletonLine, styles.metricValueSkeleton]} />
    </View>
  );

  const renderSkeletonEventItem = () => (
    <View style={styles.eventItem}>
      <View style={styles.bulletPointSkeleton} />
      <View style={styles.eventHeader}>
        <View style={[styles.skeletonLine, styles.timestampSkeleton]} />
        <View style={styles.dotSkeleton} />
        <View style={[styles.skeletonLine, styles.scoreSkeleton]} />
      </View>
      <View style={[styles.skeletonLine, styles.descriptionSkeleton]} />
      <View style={[styles.skeletonLine, styles.descriptionSkeletonShort]} />
    </View>
  );

  const renderSkeletonFeedbackItem = () => (
    <View style={styles.feedbackItem}>
      <View style={styles.bulletPointSkeleton} />
      <View style={[styles.skeletonLine, styles.feedbackTextSkeleton]} />
      <View style={[styles.skeletonLine, styles.feedbackTextSkeletonShort]} />
    </View>
  );

  const renderSkeletonSection = (
    titleSkeletonWidth: string,
    itemCount: number,
    renderItem: () => React.ReactNode,
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionContent}>
        {Array.from({length: itemCount}).map((_, index) => (
          <Animated.View key={index} style={shimmerStyle}>
            {renderItem()}
          </Animated.View>
        ))}
      </View>
    </View>
  );

  if (!isLoading) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.metricsContainer}>
        <Animated.View style={[shimmerStyle, styles.halfContainer]}>
          {renderSkeletonMetricCard()}
        </Animated.View>
        <Animated.View style={[shimmerStyle, styles.halfContainer]}>
          {renderSkeletonMetricCard()}
        </Animated.View>
      </View>

      {renderSkeletonSection('80@ms', 3, renderSkeletonEventItem)}
      {renderSkeletonSection('100@ms', 3, renderSkeletonFeedbackItem)}
      {renderSkeletonSection('120@ms', 2, renderSkeletonFeedbackItem)}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingTop: '16@vs',
  },
  metricsContainer: {
    flexDirection: 'row',
    gap: '6@ms',
    width: '100%',
    marginBottom: '16@vs',
  },
  metricCard: {
    width: '100%',
    borderRadius: '8@ms',
    padding: '10@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
  },
  section: {
    paddingBottom: '12@vs',
    marginBottom: '16@vs',
    borderBottomWidth: '0.5@ms',
    borderColor: colors.lightGray4,
  },
  sectionHeader: {
    marginBottom: '12@vs',
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionContent: {
    gap: '12@vs',
  },
  eventItem: {
    borderRadius: '8@ms',
    padding: '16@ms',
    paddingVertical: '4@vs',
    width: '100%',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '4@vs',
  },
  feedbackItem: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '16@ms',
    paddingVertical: '4@vs',
    width: '100%',
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  // Skeleton styles
  skeletonLine: {
    backgroundColor: colors.lightGray4,
    borderRadius: '20@ms',
    height: '12@vs',
  },
  metricLabelSkeleton: {
    width: '60@ms',
    marginBottom: '4@vs',
  },
  metricValueSkeleton: {
    width: '40@ms',
  },
  sectionIconSkeleton: {
    width: '20@ms',
    height: '20@ms',
    backgroundColor: colors.lightGray4,
    borderRadius: '4@ms',
    marginRight: '8@ms',
  },
  timestampSkeleton: {
    width: '35@ms',
  },
  scoreSkeleton: {
    width: '20@ms',
  },
  descriptionSkeleton: {
    width: '100%',
    marginBottom: '4@vs',
  },
  descriptionSkeletonShort: {
    width: '70%',
  },
  feedbackTextSkeleton: {
    width: '100%',
    marginBottom: '4@vs',
  },
  feedbackTextSkeletonShort: {
    width: '60%',
  },
  viewMoreSkeleton: {
    width: '60@ms',
  },
  arrowSkeleton: {
    width: '10@ms',
    height: '10@ms',
    backgroundColor: colors.lightGray4,
    borderRadius: '2@ms',
  },
  dotSkeleton: {
    width: '3@ms',
    height: '3@ms',
    backgroundColor: colors.lightGray4,
    borderRadius: '50%',
  },
  bulletPointSkeleton: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.lightGray4,
    borderRadius: '50%',
    position: 'absolute',
    left: '4@ms',
    top: '12@ms',
  },
  fillContainer: {
    width: '100%',
  },
  halfContainer: {
    width: '50%',
  },
});
