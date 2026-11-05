import React from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';

import {ThumbIcon} from '@/assets/icons';
import {USER_PERMISSIONS} from '@/constants';
import {useDebounce, useTranslate} from '@/hooks';
import {
  useAddFeedbackMutation,
  useUpdateFeedbackMutation,
} from '@/services/chatApi';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme';
import {FeedbackResponse, Nudge} from '@/types';
import {logger} from '@/utils/logger';

import {CustomMarkdown} from '../CustomMarkdown';
import {SkeletonLoader} from '../SkeletonLoader';
import {styles} from './styles';

interface NudgeSectionProps {
  nudge: Nudge;
  isLoading: boolean;
  onFeedbackSuccess: (feedback: FeedbackResponse) => void;
}

export const NudgeSection: React.FC<NudgeSectionProps> = ({
  nudge,
  isLoading,
  onFeedbackSuccess,
}) => {
  const {t} = useTranslate();
  const permissions = useAppSelector(state => state.user.permissions);
  const [addFeedback] = useAddFeedbackMutation();
  const [updateFeedback, {isLoading: isUpdateFeedbackLoading}] =
    useUpdateFeedbackMutation();
  const hasFeedbackPermission = permissions?.includes(
    USER_PERMISSIONS.EDIT_MESSAGE_FEEDBACK,
  );

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
            {t('listeningScreen.isThisHelpful')}
          </Text>
          {hasFeedbackPermission && (
            <View style={styles.feedbackButtons}>
              <TouchableOpacity
                style={styles.thumbContainer}
                onPress={() => handleFeedback(false)}
                disabled={isUpdateFeedbackLoading}
                activeOpacity={0.7}>
                <ThumbIcon
                  width={18}
                  height={18}
                  style={styles.thumbDown}
                  color={
                    nudge.feedback?.rating === 0
                      ? colors.white
                      : colors.powderBlue
                  }
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.thumbContainer}
                onPress={() => handleFeedback(true)}
                disabled={isUpdateFeedbackLoading}
                activeOpacity={0.7}>
                <ThumbIcon
                  width={18}
                  height={18}
                  color={
                    nudge.feedback?.rating === 1
                      ? colors.white
                      : colors.powderBlue
                  }
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </>
    );
  };

  return (
    <View style={[styles.container]}>
      <View style={styles.content}>{renderContent()}</View>
    </View>
  );
};
