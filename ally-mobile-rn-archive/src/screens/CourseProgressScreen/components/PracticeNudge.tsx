import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackSkillCategoryFeedback} from '@/types';

interface PracticeNudgeProps {
  skillCategories: TrackSkillCategoryFeedback[];
  onContinuePress: () => void;
}

/**
 * Points at the single weakest `needs_practice` category (if any) with a CTA
 * back into the course. There is no per-item mapping from a skill category to
 * "the roleplay that covers it" — categories are aggregated across every
 * roleplay in the course, not tagged per item — so the honest action is
 * "keep practicing this course" via the same next-item flow
 * CourseOverviewScreen's Start/Continue button already uses, not a claim of
 * surgical targeting.
 */
export const PracticeNudge: React.FC<PracticeNudgeProps> = ({
  skillCategories,
  onContinuePress,
}) => {
  const {t} = useTranslate();

  const weakest = [...skillCategories]
    .filter(skill => skill.classification === 'needs_practice')
    .sort((a, b) => (a.averagePercentage ?? 0) - (b.averagePercentage ?? 0))[0];

  if (!weakest) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        {t('courses.progressDashboard.practiceNudge', {
          category: weakest.category,
        })}
      </Text>
      <TouchableOpacity
        onPress={onContinuePress}
        style={styles.button}
        accessibilityRole="button"
        testID="practice-nudge-continue">
        <Text style={styles.buttonText}>{t('common.continue')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12@ms',
    backgroundColor: colors.ds.blue[50],
    borderRadius: '12@ms',
    padding: '12@ms',
    marginTop: '16@ms',
  },
  text: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  button: {
    backgroundColor: colors.ds.theme.primary,
    borderRadius: '20@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '8@mvs',
  },
  buttonText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.white,
  },
});
