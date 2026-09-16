import React, {useCallback} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BottomSheet} from '@/components/BottomSheet';
import {getLabelFromCode} from '@/components/LanguageSelectorSheet';
import {useTranslate} from '@/hooks';
import {useSetTrackLanguageMutation} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import type {TrackLanguageOption} from '@/types';

interface CourseLanguageSheetProps {
  visible: boolean;
  onClose: () => void;
  trackId: string;
  /** Published languages for this course, English first. */
  options: TrackLanguageOption[];
  /** What the learner is reading it in now. */
  currentLanguageCode: string;
}

/**
 * Per-course language picker.
 *
 * Separate from the app-wide `LanguageSelectorSheet` on purpose: this changes
 * what ONE course reads in, not the whole app, so a learner can work through a
 * Hindi course while keeping an English interface (or the reverse). The choice
 * persists on their enrollment.
 *
 * Only languages a trainer has published are offered — a half-translated course
 * never appears here — and English is always present, being the authored source.
 *
 * Labels prefer the app's own endonyms (हिंदी, தமிழ்) over the backend's English
 * names, so this list reads the same as the app language picker. Falls back to
 * the backend label for a language the app has no endonym for.
 */
export const CourseLanguageSheet: React.FC<CourseLanguageSheetProps> = ({
  visible,
  onClose,
  trackId,
  options,
  currentLanguageCode,
}) => {
  const {t} = useTranslate();
  const [setTrackLanguage, {isLoading}] = useSetTrackLanguageMutation();

  const handleSelect = useCallback(
    async (languageCode: string) => {
      if (languageCode === currentLanguageCode) {
        onClose();
        return;
      }
      try {
        // The mutation invalidates the whole track cache — every title, prompt
        // and option in the course changes with the language.
        await setTrackLanguage({trackId, languageCode}).unwrap();
      } catch {
        // Swallow: the learner keeps reading in the current language and can
        // retry. Progress is keyed by component id, so nothing is at risk.
      } finally {
        onClose();
      }
    },
    [currentLanguageCode, onClose, setTrackLanguage, trackId],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={45}
      allowFullExpand={false}
      enableDynamicSizing={false}
      backgroundColor={colors.white}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('courses.language.title')}</Text>
        <Text style={styles.subtitle}>{t('courses.language.subtitle')}</Text>
        {options.map(option => {
          const isSelected = option.languageCode === currentLanguageCode;
          return (
            <TouchableOpacity
              key={option.languageCode}
              style={styles.option}
              onPress={() => handleSelect(option.languageCode)}
              activeOpacity={0.7}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityState={{selected: isSelected, disabled: isLoading}}
              testID={`course-language-option-${option.languageCode}`}>
              <Text
                style={[
                  styles.optionText,
                  isSelected && styles.optionTextSelected,
                ]}>
                {option.isSource
                  ? option.label
                  : (getLabelFromCode(option.languageCode) ?? option.label)}
              </Text>
              {isSelected && <View style={styles.selectedDot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '16@ms',
    paddingBottom: '24@mvs',
  },
  title: {
    ...typography.label.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@mvs',
  },
  subtitle: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '16@mvs',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '14@mvs',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  optionText: {
    ...typography.body.large,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.mediumEmphasis,
  },
  optionTextSelected: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
  },
  selectedDot: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.theme.primary,
  },
});
