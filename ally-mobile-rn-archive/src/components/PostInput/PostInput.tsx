import React from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius, typography} from '@/theme';

export interface PostInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  maxLength: number;
  placeholder?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  autoFocus?: boolean;
  testID?: string;
}

/**
 * Plain multiline composer shared by the top-level post box, the reply
 * box and inline edit — a live char counter against `viewer.maxLength`
 * and a submit disabled whenever the trimmed value is empty or over the
 * limit (courses.discussion.composerPlaceholder / submit copy live in
 * en.json, mirroring the rest of the course player's strings).
 */
export const PostInput: React.FC<PostInputProps> = ({
  value,
  onChangeText,
  onSubmit,
  maxLength,
  placeholder,
  submitLabel,
  isSubmitting = false,
  onCancel,
  cancelLabel,
  autoFocus = false,
  testID = 'post-input',
}) => {
  const {t} = useTranslate();
  const trimmedLength = value.trim().length;
  const isOverLimit = value.length > maxLength;
  const isDisabled = trimmedLength === 0 || isOverLimit || isSubmitting;

  return (
    <View style={styles.container}>
      <TextInput
        testID={testID}
        style={[styles.input, isOverLimit && styles.inputOverLimit]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? t('courses.discussion.composerPlaceholder')}
        placeholderTextColor={colors.ds.typography.lowEmphasis}
        multiline
        textAlignVertical="top"
        editable={!isSubmitting}
        autoFocus={autoFocus}
      />
      <View style={styles.footer}>
        <Text
          testID={`${testID}-char-count`}
          style={[styles.charCount, isOverLimit && styles.charCountOverLimit]}>
          {value.length}/{maxLength}
        </Text>
        <View style={styles.actions}>
          {onCancel ? (
            <TouchableOpacity
              testID={`${testID}-cancel`}
              onPress={onCancel}
              disabled={isSubmitting}
              style={styles.cancelButton}>
              <Text style={styles.cancelText}>
                {cancelLabel ?? t('common.cancel')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            testID={`${testID}-submit`}
            onPress={onSubmit}
            disabled={isDisabled}
            style={[
              styles.submitButton,
              isDisabled && styles.submitButtonDisabled,
            ]}>
            {isSubmitting ? (
              <ActivityIndicator size="small" color={colors.ds.neutral.white} />
            ) : (
              <Text style={styles.submitText}>
                {submitLabel ?? t('courses.discussion.post')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    gap: '6@ms',
  },
  input: {
    minHeight: '64@mvs',
    maxHeight: '160@mvs',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.lg,
    paddingHorizontal: '12@ms',
    paddingVertical: '10@mvs',
    backgroundColor: colors.ds.neutral.white,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  inputOverLimit: {
    borderColor: colors.ds.red[400],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCount: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  charCountOverLimit: {
    color: colors.ds.red[400],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  cancelButton: {
    paddingVertical: '6@mvs',
    paddingHorizontal: '10@ms',
  },
  cancelText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '13@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  submitButton: {
    backgroundColor: colors.ds.theme.primary,
    borderRadius: radius.full,
    paddingVertical: '6@mvs',
    paddingHorizontal: '16@ms',
    minWidth: '64@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: colors.ds.state.disabledContent,
  },
  submitText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '13@ms',
    color: colors.ds.neutral.white,
  },
});
