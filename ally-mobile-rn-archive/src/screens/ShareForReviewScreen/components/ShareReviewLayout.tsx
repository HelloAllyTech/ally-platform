import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';
import EmojiKeyboard, {type EmojiType} from 'rn-emoji-keyboard';

import {AddReactionIcon, CloseIcon} from '@/assets';
import {Button, LineTextInput} from '@/components';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, typography} from '@/theme';

interface ShareReviewLayoutProps {
  screenTitle: string;
  note: string;
  onChangeNote: (text: string) => void;
  maxNoteLength?: number;
  showNoteLength?: boolean;
  buttonLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  isEmojiPickerOpen: boolean;
  setIsEmojiPickerOpen: (open: boolean) => void;
  onEmojiSelected: (emoji: EmojiType) => void;
  children?: React.ReactNode;
}

export const ShareReviewLayout = ({
  screenTitle,
  note,
  onChangeNote,
  maxNoteLength,
  showNoteLength,
  buttonLabel,
  onSubmit,
  onClose,
  isEmojiPickerOpen,
  setIsEmojiPickerOpen,
  onEmojiSelected,
  children,
}: ShareReviewLayoutProps) => {
  const {t} = useTranslate();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[{paddingTop: insets.top}, styles.scrollView]}
      contentContainerStyle={[
        {paddingBottom: insets.bottom},
        styles.container,
      ]}>
      <View style={styles.screenHeader}>
        <TouchableOpacity onPress={onClose}>
          <CloseIcon width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.screenHeaderTitle}>{screenTitle}</Text>
      </View>
      <LineTextInput
        placeholder={t('review.addNotePlaceholder')}
        value={note}
        onChangeText={onChangeNote}
        maxLength={maxNoteLength}
      />
      {showNoteLength && maxNoteLength !== undefined && (
        <View>
          <Text style={styles.noteLength}>
            {Array.from(note).length}/{maxNoteLength}
          </Text>
        </View>
      )}
      {children}
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
        onEmojiSelected={onEmojiSelected}
        allowMultipleSelections
        enableRecentlyUsed
        enableSearchBar
        hideHeader
      />
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  container: {
    paddingBottom: '32@ms',
    paddingHorizontal: '24@ms',
    gap: '16@ms',
    flexGrow: 1,
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
  noteLength: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.lowEmphasis,
    marginLeft: 'auto',
  },
});
