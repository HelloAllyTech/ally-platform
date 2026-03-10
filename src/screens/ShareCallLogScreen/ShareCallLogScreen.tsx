import {useTranslation} from 'react-i18next';

import {SimulationDetailRow, SimulationDetailsCard} from '@/components';
import {useShareScreenLogic} from '@/hooks/useShareScreenLogic';
import {RootStackScreenProps} from '@/navigation';
import {ShareReviewLayout} from '@/screens/ShareSimulationScreen/components/ShareReviewLayout';
import {formatDateTime} from '@/utils';

export const ShareCallLogScreen: React.FC<
  RootStackScreenProps<'ShareCallLog'>
> = ({route}) => {
  const {scenarioData, ...shareParams} = route.params;
  const {t} = useTranslation();

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
    scenarioSessionId: shareParams.scenarioSessionId,
    isEditNote: shareParams.isEditNote,
    initialNote: shareParams.note,
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
        coverImageUrl={scenarioData.coverImageUrl}
        coverVideoUrl={scenarioData.coverVideoUrl}
        title={scenarioData.title}
        description={
          <>
            <SimulationDetailRow
              label={t('Review.card.dateAndTime')}
              value={formatDateTime(scenarioData.createdAt)}
            />
            {scenarioData.duration !== undefined && (
              <SimulationDetailRow
                label={t('Review.card.duration')}
                value={scenarioData.duration}
              />
            )}
          </>
        }
      />
    </ShareReviewLayout>
  );
};
