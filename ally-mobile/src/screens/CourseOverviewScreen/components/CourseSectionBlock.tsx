import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CircularProgress} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackDetailItem, TrackItemStatus, TrackSection} from '@/types';
import {htmlToPlainText} from '@/utils';

import {CourseItemRow} from './CourseItemRow';

export interface CourseSectionBlockProps {
  section: TrackSection;
  sectionIndex: number;
  /** Id of the next actionable item across the whole course (for the chip). */
  nextItemId: string | null;
  onItemPress: (item: TrackDetailItem) => void;
}

export const CourseSectionBlock: React.FC<CourseSectionBlockProps> = ({
  section,
  sectionIndex,
  nextItemId,
  onItemPress,
}) => {
  const {t} = useTranslate();
  const items = [...section.items].sort((a, b) => a.order - b.order);
  const completedCount = items.filter(
    item => item.status === TrackItemStatus.COMPLETED,
  ).length;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <CircularProgress
          progress={completedCount}
          max={items.length || 1}
          size={44}
          strokeWidth={3}
          progressColor={colors.ds.theme.primary}>
          <Text style={styles.indexText}>{sectionIndex + 1}</Text>
        </CircularProgress>
        <View style={styles.headerText}>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {section.title}
          </Text>
          <Text style={styles.sectionSubtitle} numberOfLines={1}>
            {htmlToPlainText(section.description) ||
              t('courses.progress', {
                completed: completedCount,
                total: items.length,
              })}
          </Text>
        </View>
      </View>

      <View style={styles.itemsList}>
        {items.map(item => (
          <CourseItemRow
            key={item.id}
            item={item}
            isNext={item.id === nextItemId}
            onPress={onItemPress}
          />
        ))}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  section: {
    gap: '10@ms',
    marginBottom: '20@ms',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  indexText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  headerText: {
    flex: 1,
    gap: '2@ms',
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sectionSubtitle: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  itemsList: {
    gap: '8@ms',
  },
});
