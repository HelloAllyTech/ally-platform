import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CircularProgress} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {SkillFeedbackClassification, TrackSkillCategoryFeedback} from '@/types';

interface SkillCategoryRowProps {
  skill: TrackSkillCategoryFeedback;
}

const RING_COLOR: Record<SkillFeedbackClassification, string> = {
  demonstrated: colors.ds.green[500],
  needs_practice: colors.ds.orange[500],
  insufficient_data: colors.ds.grey[400],
};

const BADGE_BG: Record<SkillFeedbackClassification, string> = {
  demonstrated: colors.ds.green[50],
  needs_practice: colors.ds.orange[50],
  insufficient_data: colors.ds.grey[100],
};

const BADGE_TEXT: Record<SkillFeedbackClassification, string> = {
  demonstrated: colors.ds.green[800],
  needs_practice: colors.ds.orange[800],
  insufficient_data: colors.ds.typography.mediumEmphasis,
};

/** One skill category's rollup: label, ring, and a classification badge. */
export const SkillCategoryRow: React.FC<SkillCategoryRowProps> = ({skill}) => {
  const {t} = useTranslate();
  const isInsufficient = skill.classification === 'insufficient_data';

  return (
    <View style={styles.container}>
      <CircularProgress
        progress={isInsufficient ? 0 : (skill.averagePercentage ?? 0)}
        size={40}
        strokeWidth={3}
        progressColor={RING_COLOR[skill.classification]}>
        {!isInsufficient && (
          <Text style={styles.pct}>{skill.averagePercentage}%</Text>
        )}
      </CircularProgress>
      <View style={styles.textColumn}>
        <Text style={styles.category} numberOfLines={1}>
          {skill.category}
        </Text>
        <View
          style={[
            styles.badge,
            {backgroundColor: BADGE_BG[skill.classification]},
          ]}>
          <Text
            style={[
              styles.badgeText,
              {color: BADGE_TEXT[skill.classification]},
            ]}>
            {t(
              `courses.progressDashboard.classification.${skill.classification}`,
            )}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
  },
  pct: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '11@ms',
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  textColumn: {
    flex: 1,
    gap: '4@ms',
  },
  category: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: '10@ms',
    paddingHorizontal: '8@ms',
    paddingVertical: '2@ms',
  },
  badgeText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.medium,
  },
});
