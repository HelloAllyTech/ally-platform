import {useCallback} from 'react';
import {useTranslation} from 'react-i18next';

import {useToast} from '@/components';
import {useUpdateReviewStatusMutation} from '@/services';
import {ReviewStatus} from '@/types';

type UpdateReviewStatusHook = typeof useUpdateReviewStatusMutation;

export const useToggleReviewPrivacy = (
  reviewId?: string,
  useUpdateMutation: UpdateReviewStatusHook = useUpdateReviewStatusMutation,
) => {
  const {t} = useTranslation();
  const {showToast} = useToast();
  const [updateReviewStatus] = useUpdateMutation();

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
        showToast(t('simulationPage.privacyUpdated'), 'success');
      } catch (error) {
        console.error('Error updating review status:', error);
        showToast(t('simulationPage.errorUpdatePrivacy'), 'error');
      }
    },
    [reviewId, updateReviewStatus, showToast, t],
  );

  return {handleTogglePrivate};
};
