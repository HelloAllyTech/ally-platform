import {useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {View} from 'react-native';

import {SimulationDetailRow, SimulationDetailsCard} from '@/components';
import {useShareScreenLogic} from '@/hooks/useShareScreenLogic';
import {RootStackScreenProps} from '@/navigation';
import {
  useCreateReviewMutation,
  useUpdateReviewStatusMutation,
} from '@/services';
import {ReviewStatus} from '@/types';
import {formatDateTime} from '@/utils';

import {ShareReviewLayout} from './components';

export const ShareSimulationScreen: React.FC<
  RootStackScreenProps<'ShareSimulation'>
> = ({route}) => {
  const {scenarioData, ...shareParams} = route.params;
  const {t} = useTranslation();

  const [createReview] = useCreateReviewMutation();
  const [updateReviewStatus] = useUpdateReviewStatusMutation();

  const onCreateReview = useCallback(
    async (note: string) => {
      if (!shareParams.scenarioSessionId) return;
      await createReview({
        scenarioSessionId: shareParams.scenarioSessionId,
        note,
      }).unwrap();
    },
    [createReview, shareParams.scenarioSessionId],
  );

  const onUpdateStatus = useCallback(
    async (reviewId: string, note: string) => {
      await updateReviewStatus({
        reviewId,
        body: {status: ReviewStatus.IN_REVIEW, note},
      }).unwrap();
    },
    [updateReviewStatus],
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
    onCreateReview,
    onUpdateStatus,
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
      <View>
        <SimulationDetailRow
          label={t('review.details.dateAndTime')}
          value={formatDateTime(scenarioData.createdAt)}
        />
        {scenarioData.duration !== undefined && (
          <SimulationDetailRow
            label={t('review.feedCard.duration')}
            value={scenarioData.duration}
          />
        )}
      </View>
      <SimulationDetailsCard
        reviewType="simulation"
        coverImageUrl={scenarioData.coverImageUrl}
        coverVideoUrl={scenarioData.coverVideoUrl}
        title={scenarioData.title}
        description={scenarioData.description}
      />
    </ShareReviewLayout>
  );
};
