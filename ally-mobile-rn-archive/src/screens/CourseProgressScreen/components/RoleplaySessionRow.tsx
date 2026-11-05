import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronRight} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackRoleplaySessionFeedback} from '@/types';

interface RoleplaySessionRowProps {
  session: TrackRoleplaySessionFeedback;
  onPress: (session: TrackRoleplaySessionFeedback) => void;
}

/**
 * One evaluated (or pending) roleplay attempt. Deep-links out to the
 * existing SimulationFeedback screen rather than re-rendering
 * evaluationMarkdown here.
 */
export const RoleplaySessionRow: React.FC<RoleplaySessionRowProps> = ({
  session,
  onPress,
}) => {
  const {t} = useTranslate();

  const formattedDate = session.occurredAt
    ? new Date(session.occurredAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(session)}
      accessibilityRole="button">
      <View style={styles.textColumn}>
        <Text style={styles.title} numberOfLines={1}>
          {session.trackItemTitle ??
            t('courses.progressDashboard.untitledSession')}
        </Text>
        <Text style={styles.subtitle}>
          {session.compositeScore !== null
            ? t('courses.progressDashboard.sessionScore', {
                score: session.compositeScore,
              })
            : t('courses.progressDashboard.sessionPending')}
          {formattedDate ? ` · ${formattedDate}` : ''}
        </Text>
      </View>
      <ChevronRight />
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
  },
  textColumn: {
    flex: 1,
    gap: '4@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  subtitle: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.mediumEmphasis,
  },
});
