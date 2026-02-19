import React, {useEffect} from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useToast} from '@/components';
import {useTranslate} from '@/hooks';
import {
  useCreateReviewMutation,
  useLazyGetSimulationDetailsQuery,
  useUpdateReviewStatusMutation,
} from '@/services';
import {ReviewStatus} from '@/types';

import {PrivacyToggle, SimulationTranscript} from '../';

interface TranscriptTabProps {
  scenarioSessionId: string;
  reviewId?: string;
  setReviewId: (reviewId: string) => void;
  isPrivate: boolean;
  setIsPrivate: (isPrivate: boolean) => void;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  scenarioSessionId,
  reviewId,
  setReviewId,
  isPrivate,
  setIsPrivate,
}) => {
  const {t} = useTranslate();
  const {showToast} = useToast();

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();
  const [createReview] = useCreateReviewMutation();
  const [updateReviewStatus] = useUpdateReviewStatusMutation();

  useEffect(() => {
    if (scenarioSessionId) {
      getSimulationDetails({id: scenarioSessionId});
    }
  }, [scenarioSessionId, getSimulationDetails]);

  useEffect(() => {
    if (simulationDetails?.reviewId) {
      setReviewId(simulationDetails.reviewId);
      if (simulationDetails.reviewStatus === ReviewStatus.IN_REVIEW) {
        setIsPrivate(false);
      } else if (simulationDetails.reviewStatus === ReviewStatus.HIDDEN) {
        setIsPrivate(true);
      }
    }
  }, [
    setIsPrivate,
    setReviewId,
    simulationDetails?.reviewId,
    simulationDetails?.reviewStatus,
  ]);

  const handlePrivacyToggle = async (isPrivateValue: boolean) => {
    // Optimistically update the UI
    setIsPrivate(isPrivateValue);

    try {
      let currentReviewId = reviewId;

      // If no reviewId exists, create a review first
      if (!currentReviewId && scenarioSessionId) {
        const createReviewResponse = await createReview({
          scenarioSessionId,
        }).unwrap();
        currentReviewId = createReviewResponse.id;
        setReviewId(currentReviewId);
        return;
      }

      // If we still don't have a reviewId, something went wrong
      if (!currentReviewId) {
        throw new Error('Failed to create or retrieve review ID');
      }

      // Update the review status
      await updateReviewStatus({
        reviewId: currentReviewId,
        status: {
          status: isPrivateValue ? ReviewStatus.HIDDEN : ReviewStatus.IN_REVIEW,
        },
      }).unwrap();

      showToast(
        isPrivateValue
          ? t('SimulationFeedback.privacyUpdated')
          : t('SimulationFeedback.sharedForReview'),
        'success',
      );
    } catch (error) {
      console.error('Error updating review status:', error);
      showToast(t('Errors.updatePrivacy'), 'error');
      // Revert the toggle state on error
      setIsPrivate(!isPrivateValue);
    }
  };

  if (!scenarioSessionId) {
    return null;
  }

  return (
    <>
      <SimulationTranscript
        sessionId={scenarioSessionId}
        startedAt={simulationDetails?.startedAt}
        agentName={simulationDetails?.scenario?.metadata?.name}
      />
      <View style={styles.privacyToggleContainer}>
        <PrivacyToggle isPrivate={isPrivate} onToggle={handlePrivacyToggle} />
      </View>
    </>
  );
};

const styles = ScaledSheet.create({
  privacyToggleContainer: {
    position: 'absolute',
    bottom: '30@vs',
    left: 0,
    right: 0,
  },
});
