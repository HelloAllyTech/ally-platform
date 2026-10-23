import {useCallback} from 'react';
import {useTranslation} from 'react-i18next';

import {SimulationDetailRow, SimulationDetailsCard} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useShareScreenLogic} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {
  useCreateScribeReviewMutation,
  useUpdateScribeReviewStatusMutation,
} from '@/services/scribeReviewsApi';
import {ReviewStatus} from '@/types';
import {formatDateTime} from '@/utils';

import {ShareReviewLayout} from './components';

export const ShareCallLogScreen: React.FC<
  RootStackScreenProps<'ShareCallLog'>
> = ({route}) => {
  const {sessionData, ...shareParams} = route.params;
  const {t} = useTranslation();
  const navigation = useAppNavigation();

  const [createScribeReview] = useCreateScribeReviewMutation();
  const [updateScribeReviewStatus] = useUpdateScribeReviewStatusMutation();

  const onCreateReview = useCallback(
    async (note: string) => {
      if (shareParams.scribeSessionId === undefined) return;
      return createScribeReview({
        scribeSessionId: Number(shareParams.scribeSessionId),
        note,
      }).unwrap();
    },
    [createScribeReview, shareParams.scribeSessionId],
  );

  const onUpdateStatus = useCallback(
    async (reviewId: string, note: string) => {
      await updateScribeReviewStatus({
        reviewId,
        body: {status: ReviewStatus.IN_REVIEW, note},
      }).unwrap();
    },
    [updateScribeReviewStatus],
  );

  const onShareSuccess = useCallback(
    (result?: {id?: string} | void) => {
      if (result && result.id) {
        navigation.replace(SCREEN_NAMES.SCRIBE_REVIEW_DETAILS, {
          reviewId: result.id,
        });
      } else {
        navigation.goBack();
      }
    },
    [navigation],
  );

  const {
    note,
    setNote,
    onSubmit,
    screenTitle,
    buttonLabel,
    isEmojiPickerOpen,
    setIsEmojiPickerOpen,
    handleEmojiSelected,
    goBack,
    maxNoteLength,
  } = useShareScreenLogic({
    reviewId: shareParams.reviewId,
    isEditNote: shareParams.isEditNote,
    initialNote: shareParams.note,
    shareTitle: t('review.details.shareModalHeader'),
    onCreateReview,
    onUpdateStatus,
    onShareSuccess,
  });

  return (
    <ShareReviewLayout
      screenTitle={screenTitle}
      note={note}
      onChangeNote={setNote}
      maxNoteLength={maxNoteLength}
      showNoteLength
      buttonLabel={buttonLabel}
      onSubmit={onSubmit}
      onClose={goBack}
      isEmojiPickerOpen={isEmojiPickerOpen}
      setIsEmojiPickerOpen={setIsEmojiPickerOpen}
      onEmojiSelected={handleEmojiSelected}>
      <SimulationDetailsCard
        reviewType="scribe"
        title={sessionData.title}
        description={
          <>
            <SimulationDetailRow
              label={t('review.details.dateAndTime')}
              value={formatDateTime(sessionData.createdAt)}
            />
            {sessionData.duration !== undefined && (
              <SimulationDetailRow
                label={t('review.feedCard.duration')}
                value={sessionData.duration}
              />
            )}
          </>
        }
      />
    </ShareReviewLayout>
  );
};
