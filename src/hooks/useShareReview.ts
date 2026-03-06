import {useCallback, useState} from 'react';
import {useTranslation} from 'react-i18next';

import {useToast} from '@/components';
import {
  useCreateReviewMutation,
  useUpdateReviewStatusMutation,
} from '@/services';
import {ReviewStatus} from '@/types';

import {useAppNavigation} from './useAppNavigation';

interface UseShareReviewParams {
  reviewId?: string;
  scenarioSessionId?: string;
}

export const useShareReview = ({
  reviewId,
  scenarioSessionId,
}: UseShareReviewParams) => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const {showToast} = useToast();

  const [note, setNote] = useState<string>('');
  const [isPrivate, setIsPrivate] = useState<boolean>(false);

  const [createReview] = useCreateReviewMutation();
  const [updateReviewStatus] = useUpdateReviewStatusMutation();

  const handleTogglePrivate = useCallback(
    async (isEnabled: boolean) => {
      if (!reviewId) return;
      try {
        const newStatus = isEnabled
          ? ReviewStatus.IN_REVIEW
          : ReviewStatus.HIDDEN;
        await updateReviewStatus({
          reviewId,
          body: {status: newStatus},
        }).unwrap();
        setIsPrivate(!isEnabled);
        showToast(t('SimulationFeedback.privacyUpdated'), 'success');
      } catch (error) {
        console.error('Error updating review status:', error);
        showToast(t('Errors.updatePrivacy'), 'error');
      }
    },
    [reviewId, updateReviewStatus, showToast, t],
  );

  const handleShare = useCallback(async () => {
    try {
      if (reviewId) {
        await updateReviewStatus({
          reviewId,
          body: {status: ReviewStatus.IN_REVIEW, note},
        }).unwrap();
      } else if (scenarioSessionId) {
        await createReview({
          scenarioSessionId,
          note,
        }).unwrap();
      }

      showToast(t('SimulationFeedback.sharedForReview'), 'success');
      navigation.goBack();
    } catch (error) {
      console.error('Error sharing simulation:', error);
      showToast(t('Errors.updatePrivacy'), 'error');
    }
  }, [
    reviewId,
    scenarioSessionId,
    createReview,
    updateReviewStatus,
    showToast,
    t,
    navigation,
    note,
  ]);

  const handleEditNote = useCallback(async () => {
    if (!reviewId) return;
    try {
      await updateReviewStatus({
        reviewId,
        body: {status: ReviewStatus.IN_REVIEW, note},
      }).unwrap();
      showToast(t('SimulationFeedback.noteUpdated'), 'success');
      navigation.goBack();
    } catch (error) {
      console.error('Error editing note:', error);
      showToast(t('Errors.updatePrivacy'), 'error');
    }
  }, [reviewId, updateReviewStatus, note, navigation, showToast, t]);

  return {
    note,
    setNote,
    isPrivate,
    setIsPrivate,
    handleTogglePrivate,
    handleShare,
    handleEditNote,
  };
};
