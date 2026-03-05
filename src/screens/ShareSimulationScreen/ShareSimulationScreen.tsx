import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {SafeAreaView, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';
import EmojiKeyboard, {type EmojiType} from 'rn-emoji-keyboard';

import {AddReactionIcon, CloseIcon} from '@/assets';
import {
  Button,
  LineTextInput,
  SimulationDetailRow,
  SimulationDetailsCard,
} from '@/components';
import {useAppNavigation, useShareReview} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {colors, fontFamily, typography} from '@/theme';
import {formatDateTime, formatDurationFromSeconds} from '@/utils';

export const ShareSimulationScreen: React.FC<
  RootStackScreenProps<'ShareSimulation'>
> = ({route}) => {
  const {
    reviewId,
    scenarioSessionId,
    scenarioData,
    isEditNote,
    note: initialNote,
  } = route.params;
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();

  const {note, setNote, handleShare, handleEditNote} = useShareReview({
    reviewId,
    scenarioSessionId,
  });

  useEffect(() => {
    if (initialNote) {
      setNote(initialNote);
    }
  }, [isEditNote, initialNote, setNote]);

  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  const handleEmojiSelected = useCallback(
    (emoji: EmojiType) => {
      setNote(prev => prev + emoji.emoji);
    },
    [setNote],
  );

  const screenTitle = isEditNote
    ? t('SimulationFeedback.editNoteTitle')
    : t('SimulationFeedback.shareScreenTitle');

  const buttonLabel = isEditNote ? t('save') : t('SimulationFeedback.share');

  const onSubmit = isEditNote ? handleEditNote : handleShare;

  const renderScreenHeader = () => {
    return (
      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <CloseIcon width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.screenHeaderTitle}>{screenTitle}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[{paddingTop: insets.top}, styles.container]}>
      {renderScreenHeader()}
      <LineTextInput
        placeholder="Add a note..."
        value={note}
        onChangeText={setNote}
      />
      <View>
        <SimulationDetailRow
          label={t('Review.card.dateAndTime')}
          value={formatDateTime(scenarioData.createdAt)}
        />
        {scenarioData.duration !== undefined && (
          <SimulationDetailRow
            label={t('Review.card.duration')}
            value={formatDurationFromSeconds(scenarioData.duration)}
          />
        )}
      </View>
      <SimulationDetailsCard
        coverImageUrl={scenarioData.coverImageUrl}
        coverVideoUrl={scenarioData.coverVideoUrl}
        title={scenarioData.title}
        description={scenarioData.description}
      />
      <TouchableOpacity onPress={() => setIsEmojiPickerOpen(true)}>
        <AddReactionIcon width={24} height={24} />
      </TouchableOpacity>
      <Button
        customContainerStyle={styles.button}
        label={buttonLabel}
        onPress={onSubmit}
      />
      <EmojiKeyboard
        open={isEmojiPickerOpen}
        onClose={() => setIsEmojiPickerOpen(false)}
        onEmojiSelected={handleEmojiSelected}
      />
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingVertical: '32@ms',
    paddingHorizontal: '24@ms',
    backgroundColor: colors.ds.neutral.white,
    gap: '16@ms',
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
    marginTop: '16@ms',
  },
  screenHeaderTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.headline.tiny,
    color: colors.ds.typography.highEmphasis,
  },
  button: {
    marginTop: 'auto',
  },
});
