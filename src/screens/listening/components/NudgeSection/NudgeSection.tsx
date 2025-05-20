import React from 'react';
import {
  Dimensions,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {ThumbIcon} from '@/assets/icons';
import {useDebounce} from '@/hooks/useDebounce';
import useTranslate from '@/hooks/useTranslate';
import {
  useAddFeedbackMutation,
  useUpdateFeedbackMutation,
} from '@/services/chatApi';
import {colors} from '@/theme/colors';
import {FeedbackResponse} from '@/types/message';
import {logger} from '@/utils/logger';

import type {Nudge} from '../../ListeningScreen';
import {CustomMarkdown} from '../CustomMarkdown';
import {SkeletonLoader} from '../SkeletonLoader';
import {styles} from './styles';

const {width, height} = Dimensions.get('window');

interface NudgeSectionProps {
  isVisible: boolean;
  nudge: Nudge | null;
  isLoading: boolean;
  onFeedbackSuccess: (feedback: FeedbackResponse) => void;
}

export const NudgeSection: React.FC<NudgeSectionProps> = ({
  isVisible,
  nudge,
  isLoading,
  onFeedbackSuccess,
}) => {
  const {t} = useTranslate();
  const [addFeedback] = useAddFeedbackMutation();
  const [updateFeedback, {isLoading: isUpdateFeedbackLoading}] =
    useUpdateFeedbackMutation();

  const handleFeedbackSubmit = async (isPositive: boolean) => {
    const rating = isPositive ? 1 : 0;
    if (!nudge || isUpdateFeedbackLoading || nudge.feedback?.rating === rating)
      return;

    try {
      let response;
      if (nudge.feedback?.feedbackId) {
        response = await updateFeedback({
          feedbackId: nudge.feedback.feedbackId,
          feedback: {rating},
        }).unwrap();
      } else {
        response = await addFeedback({
          id: nudge.id,
          feedback: {rating},
        }).unwrap();
      }
      onFeedbackSuccess(response);
    } catch (error) {
      logger.error(`Error submitting feedback: ${error}`);
    }
  };

  // Debounce the feedback handler with a 500ms delay
  const handleFeedback = useDebounce(handleFeedbackSubmit, {
    delay: 500,
    leading: true, // Call on the leading edge for better UX
  });

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
        <View style={styles.feedbackContainer}>
          <Text style={styles.feedbackText}>
            {t('ListeningScreen.isThisHelpful')}
          </Text>
          <View style={styles.feedbackButtons}>
            <TouchableOpacity
              style={styles.thumbContainer}
              onPress={() => handleFeedback(false)}
              disabled={isUpdateFeedbackLoading}
              activeOpacity={0.7}>
              <ThumbIcon width={18} height={18} style={styles.thumbDown} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.thumbContainer}
              onPress={() => handleFeedback(true)}
              disabled={isUpdateFeedbackLoading}
              activeOpacity={0.7}>
              <ThumbIcon width={18} height={18} />
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  };

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      {nudge && (
        <LinearGradient
          colors={[colors.deepNavy, colors.darkNavy]}
          locations={[0, 0.24]}>
          <View style={styles.content}>{renderContent()}</View>
        </LinearGradient>
      )}
    </Animated.View>
  );
};
