import {useTranslation} from 'react-i18next';
import {View} from 'react-native';

import {SimulationDetailRow, SimulationDetailsCard} from '@/components';
import {useShareScreenLogic} from '@/hooks/useShareScreenLogic';
import {RootStackScreenProps} from '@/navigation';
import {formatDateTime} from '@/utils';

import {ShareReviewLayout} from './components/ShareReviewLayout';

export const ShareSimulationScreen: React.FC<
  RootStackScreenProps<'ShareSimulation'>
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
      <View>
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
