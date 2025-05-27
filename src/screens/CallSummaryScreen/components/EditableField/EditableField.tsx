import React from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SummaryFieldKey} from '@/constants/summary';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface EditableFieldProps {
  fieldKey: SummaryFieldKey;
  label: string;
  value: string | null;
  onChangeText: (text: string) => void;
  placeholder?: string;
  canEdit: boolean;
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
}

// TO DO: Replace with original text component or else delete this file
export const EditableField: React.FC<EditableFieldProps> = ({
  fieldKey,
  label,
  value,
  onChangeText,
  placeholder,
  canEdit,
  isEditing,
  setIsEditing,
}) => {
  return (
    <View style={styles.container}>
      <TextInput
        style={canEdit && isEditing ? styles.editableText : styles.displayText}
        key={fieldKey}
        value={value || ''}
        onChangeText={onChangeText}
        placeholder={placeholder || `Add ${label?.toLowerCase()}`}
        placeholderTextColor={colors.lightGray3}
        multiline
        onBlur={() => setIsEditing(false)}
        autoFocus={canEdit && isEditing}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    marginBottom: '16@vs',
  },
  editableText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.black,
    marginRight: '20@ms',
  },
  displayText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.lightGray3,
  },
});
