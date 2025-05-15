import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';

import {ThumbIcon} from '@/assets/icons';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';

import {styles} from './styles';
import {CustomMarkdown} from '../CustomMarkdown/';
import {SkeletonLoader} from '../SkeletonLoader';

import type {Nudge} from '../../ListeningScreen';

const {width, height} = Dimensions.get('window');

interface NudgeSectionProps {
  isVisible: boolean;
  nudge: Nudge | null;
  isLoading: boolean;
  onFeedback: (isPositive: boolean) => void;
}

export const NudgeSection: React.FC<NudgeSectionProps> = ({
  isVisible,
  nudge,
  isLoading,
  onFeedback,
}) => {
  const {t} = useTranslate();

  const animatedStyle = useAnimatedStyle(() => {
    const translateX = withSpring(isVisible ? 0 : width * 0.2, {
      damping: 15,
      mass: 0.8,
    });

    const translateY = withSpring(isVisible ? 0 : height * 0.1, {
      damping: 15,
      mass: 0.8,
    });

    return {
      opacity: withTiming(isVisible ? 1 : 0, {
        duration: 200,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      }),
      transform: [{translateX}, {translateY}],
      display: withTiming(isVisible ? 'flex' : 'none', {
        duration: 200,
      }),
    };
  });

  const renderContent = () => {
    if (isLoading) {
      return <SkeletonLoader />;
    }

    if (!nudge) {
      return null;
    }

    return (
      <>
        <ScrollView style={styles.scrollView}>
          <CustomMarkdown content={nudge.content} />
        </ScrollView>
        {!nudge.hasFeedback && (
          <View style={styles.feedbackContainer}>
            <Text style={styles.feedbackText}>
              {t('ListeningScreen.isThisHelpful')}
            </Text>
            <View style={styles.feedbackButtons}>
              <TouchableOpacity
                style={styles.thumbContainer}
                onPress={() => onFeedback(false)}
                activeOpacity={0.7}>
                <ThumbIcon width={18} height={18} style={styles.thumbDown} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.thumbContainer}
                onPress={() => onFeedback(true)}
                activeOpacity={0.7}>
                <ThumbIcon width={18} height={18} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </>
    );
  };

  // Only render if we have a nudge or are loading
  if (!nudge && !isLoading) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <LinearGradient
        colors={[colors.deepNavy, colors.darkNavy]}
        locations={[0, 0.24]}
        style={styles.gradient}>
        {renderContent()}
      </LinearGradient>
    </Animated.View>
  );
};
