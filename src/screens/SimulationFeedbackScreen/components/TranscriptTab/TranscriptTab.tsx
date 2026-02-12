import React, {useEffect, useState} from 'react';
import {StyleProp, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useToast} from '@/components';
import {useTranslate} from '@/hooks';
import {
  useLazyGetSimulationDetailsQuery,
  useUpdateReviewStatusMutation,
} from '@/services';
import {colors} from '@/theme';
import {ReviewStatus} from '@/types';

import {PrivacyToggle, SimulationTranscript} from '../';

interface TranscriptTabProps {
  scenarioSessionId?: string;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  scenarioSessionId,
}) => {
  const {t} = useTranslate();
  const {showToast} = useToast();

  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const [getSimulationDetails, {data: simulationDetails}] =
    useLazyGetSimulationDetailsQuery();
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
  }, [simulationDetails?.reviewId, simulationDetails?.reviewStatus]);

  const handlePrivacyToggle = async (isPrivateValue: boolean) => {
    if (!reviewId) {
      return;
    }

    // Optimistically update the UI
    setIsPrivate(isPrivateValue);

    try {
      await updateReviewStatus({
        reviewId,
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
      <View style={styles.privacyToggleContainer as StyleProp<ViewStyle>}>
        <PrivacyToggle isPrivate={isPrivate} onToggle={handlePrivacyToggle} />
      </View>
    </>
  );
};

const styles = ScaledSheet.create({
  privacyToggleContainer: {
    position: 'absolute',
    bottom: '20@vs',
    right: '20@ms',
    zIndex: 1000,
    backgroundColor: colors.white,
    borderRadius: '24@ms',
    padding: '4@ms',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
