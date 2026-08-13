import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import type {FlatTrackItem} from '@/hooks/useTrackPlayerNavigation';
import {colors} from '@/theme';
import {TrackItemStatus} from '@/types';

export interface SegmentedProgressRailProps {
  /** Items of the current section (one segment each). */
  sectionItems: FlatTrackItem[];
  /** Id of the item currently open in the player. */
  currentItemId: string;
}

/**
 * A one-segment-per-item progress rail for the current section. Completed
 * items fill; the active item is highlighted; the rest are muted. Mirrors
 * ally-web's `SegmentedProgressRail`.
 */
export const SegmentedProgressRail: React.FC<SegmentedProgressRailProps> = ({
  sectionItems,
  currentItemId,
}) => (
  <View style={styles.row}>
    {sectionItems.map(({item}) => {
      const isCompleted = item.status === TrackItemStatus.COMPLETED;
      const isCurrent = item.id === currentItemId;
      return (
        <View
          key={item.id}
          testID={`rail-segment-${item.id}`}
          style={[
            styles.segment,
            isCompleted
              ? styles.segmentCompleted
              : isCurrent
                ? styles.segmentCurrent
                : styles.segmentDefault,
          ]}
        />
      );
    })}
  </View>
);

const styles = ScaledSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    width: '100%',
  },
  segment: {
    flex: 1,
    height: '4@ms',
    borderRadius: '2@ms',
  },
  segmentCompleted: {
    backgroundColor: colors.ds.theme.primary,
  },
  segmentCurrent: {
    backgroundColor: colors.ds.lightBlue[200],
  },
  segmentDefault: {
    backgroundColor: colors.ds.grey[200],
  },
});
