import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackProgressSectionSummary} from '@/types';

interface SectionProgressRowProps {
  section: TrackProgressSectionSummary;
}

/**
 * One section's completed/total rollup as a slim linear bar. A local variant
 * rather than reusing CourseSectionBlock (course overview), which renders
 * full item rows — a section summary here only carries a completed/total
 * ratio.
 */
export const SectionProgressRow: React.FC<SectionProgressRowProps> = ({
  section,
}) => {
  const pct =
    section.totalItems > 0
      ? Math.round((section.completedItems / section.totalItems) * 100)
      : 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {section.title}
        </Text>
        <Text style={styles.count}>
          {section.completedItems}/{section.totalItems}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, {width: `${pct}%`}]} />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingVertical: '8@ms',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6@ms',
    gap: '8@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    flexShrink: 1,
  },
  count: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.mediumEmphasis,
  },
  track: {
    height: '6@ms',
    borderRadius: '3@ms',
    backgroundColor: colors.ds.grey[200],
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: '3@ms',
    backgroundColor: colors.ds.theme.primary,
  },
});
