import {useState} from 'react';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, InfoIcon} from '@/assets/icons';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

const AddNotesSection = ({
  onPressInfo,
  onNoteChange,
}: {
  onPressInfo: () => void;
  onNoteChange: (text: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [note, setNote] = useState<string>('');

  const handleNoteChange = (text: string) => {
    onNoteChange?.(text);
    setNote(text);
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
            <Text style={styles.title}>Add notes (Optional)</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity hitSlop={20} onPress={onPressInfo}>
          <InfoIcon />
        </TouchableOpacity>
      </View>

      {isExpanded && (
        <View style={styles.content}>
          <View style={styles.noteContainer}>
            <Text style={styles.bullet}>•</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={text => handleNoteChange(text)}
              placeholder="Enter note"
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
});

export default AddNotesSection;
