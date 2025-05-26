import React from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SummaryFieldKey} from '@/constants/summary';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

interface EditableFieldProps {
  fieldKey: SummaryFieldKey;
  label: string;
  value: string | null;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

// TO DO: Replace with original text component or else delete this file
export const EditableField: React.FC<EditableFieldProps> = ({
  fieldKey,
  label,
  value,
  onChangeText,
  placeholder,
}) => {
  return (
    <View style={styles.container}>
      <TextInput
        key={fieldKey}
        style={styles.input}
        value={value || ''}
        onChangeText={onChangeText}
        placeholder={placeholder || `Add ${label?.toLowerCase()}`}
        placeholderTextColor={colors.lightGray3}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    marginBottom: '16@vs',
  },
  label: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.mediumGray2,
    marginBottom: '8@vs',
  },
  input: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.darkSlate,
    borderWidth: 1,
    borderColor: colors.lightGray2,
    borderRadius: 4,
    padding: '12@ms',
    minHeight: '100@vs',
    textAlignVertical: 'top',
  },
});
