import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, InfoIcon, PageIcon} from '@/assets';
import {PrivacyTooltip} from '@/components';
import {colors, fontFamily} from '@/theme';

const tooltipDisplayInsets = {
  left: 40,
  right: 40,
  top: 10,
  bottom: 10,
};

export const AddNotesSection = ({
  savedNotes,
  onNoteChange,
}: {
  savedNotes: string;
  onNoteChange: (text: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [note, setNote] = useState<string>();

  const {t} = useTranslation();
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Only sync from savedNotes when the input is not focused
    if (!inputRef.current?.isFocused()) {
      setNote(savedNotes);
    }
  }, [savedNotes]);

  const handleNoteChange = (text: string) => {
    onNoteChange?.(text);
    setNote(text);
  };

  const renderTooltip = () => {
    return (
      <View style={styles.tooltipContainer}>
        <Text>{t('summaryLoading.notesTooltip')}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.header}
          onPress={() => setIsExpanded(!isExpanded)}>
          <View style={styles.titleContainer}>
            <ArrowDown
              style={[styles.chevron, isExpanded && styles.chevronExpanded]}
            />
            <PageIcon />
            <Text style={styles.title}>{t('summaryLoading.addNotes')}</Text>
          </View>
        </TouchableOpacity>
        <PrivacyTooltip
          tooltipContent={renderTooltip()}
          isVisible={showTooltip}
          onClose={() => setShowTooltip(false)}
          displayInsets={tooltipDisplayInsets}>
          <TouchableOpacity hitSlop={20} onPress={() => setShowTooltip(true)}>
            <InfoIcon />
          </TouchableOpacity>
        </PrivacyTooltip>
      </View>

      {isExpanded && (
        <View style={styles.content}>
          <View style={styles.noteContainer}>
            <Text style={styles.bullet}>•</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={note}
              onChangeText={text => handleNoteChange(text)}
              placeholder={t('callSummary.enterNote')}
              multiline
              numberOfLines={6}
              placeholderTextColor={colors.lightGray3}
            />
          </View>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: colors.white,
    overflow: 'hidden',
    marginBottom: '16@ms',
    paddingHorizontal: '8@ms',
    paddingBottom: '200@ms',
  },
  header: {
    paddingVertical: '12@ms',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.darkSlate,
    marginLeft: '8@ms',
  },
  chevron: {
    width: '20@ms',
    height: '20@ms',
    transform: [{rotate: '-90deg'}],
    marginRight: '10@ms',
    marginLeft: '4@ms',
  },
  chevronExpanded: {
    transform: [{rotate: '0deg'}],
  },
  content: {
    paddingHorizontal: '16@ms',
    paddingBottom: '16@ms',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: '12@ms',
  },
  bullet: {
    fontSize: '16@ms',
    color: colors.darkSlate,
    marginRight: '8@ms',
  },
  input: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkSlate,
    padding: 0,
    textAlignVertical: 'top',
    minHeight: '24@ms',
  },
  addButton: {
    marginTop: '8@ms',
  },
  addButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.brightBlue,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: '16@ms',
  },
  tooltipContainer: {
    backgroundColor: colors.white,
    minWidth: '280@ms',
    minHeight: '50@ms',
  },
});
