import React from 'react';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface NotesSectionProps {
  notes: string;
  onNotesChange: (text: string) => void;
  onSubmit: () => void;
}

export const NotesSection: React.FC<NotesSectionProps> = ({
  notes,
  onNotesChange,
  onSubmit,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.notesBox}>
        <Text style={styles.notesLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Take notes for the next call (if any)"
          placeholderTextColor={colors.mediumGray}
          value={notes}
          onChangeText={onNotesChange}
          multiline
        />
      </View>
      <TouchableOpacity style={styles.submitButton} onPress={onSubmit}>
        <Text style={styles.submitButtonText}>Submit</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesBox: {
    marginTop: '10@ms',
    marginBottom: '18@ms',
    width: '100%',
  },
  notesLabel: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '15@ms',
    fontWeight: '500',
    color: colors.darkSlate,
    marginBottom: '6@ms',
  },
  notesInput: {
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: colors.lightGray2,
    borderRadius: '8@ms',
    minHeight: '40@ms',
    padding: '8@ms',
    fontSize: '15@ms',
    color: colors.darkSlate,
    backgroundColor: colors.white,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  submitButton: {
    backgroundColor: colors.azureBlue,
    borderRadius: '20@ms',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '10@ms',
    marginTop: '10@ms',
    width: '100@ms',
  },
  submitButtonText: {
    color: colors.white,
    fontSize: '16@ms',
    fontWeight: '700',
    ...fontFamily.REPLAY_PRO.HEADLINE,
  },
});
