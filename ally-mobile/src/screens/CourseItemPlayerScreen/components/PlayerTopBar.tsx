import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import type {FlatTrackItem} from '@/hooks/useTrackPlayerNavigation';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {htmlToPlainText} from '@/utils';

import {SegmentedProgressRail} from './SegmentedProgressRail';

export interface PlayerTopBarProps {
  sectionTitle: string;
  /** The component's own title — the heading; the section title is its eyebrow. */
  itemTitle: string;
  /** The author's description of the component, when they wrote one. */
  itemDescription: string | null;
  sectionItems: FlatTrackItem[];
  currentItemId: string;
  overallPct: number;
  onExit: () => void;
}

/**
 * Full-screen player header: exit button, section eyebrow + current item
 * title, the item's description, the segmented progress rail for the
 * section, and the overall completion %. The item title and description
 * live here rather than inside the players so every component type shows
 * them. Mirrors ally-web's `PlayerTopBar`.
 */
export const PlayerTopBar: React.FC<PlayerTopBarProps> = ({
  sectionTitle,
  itemTitle,
  itemDescription,
  sectionItems,
  currentItemId,
  overallPct,
  onExit,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <TouchableOpacity
          testID="player-exit-button"
          onPress={onExit}
          accessibilityLabel={t('courses.player.exit')}
          style={styles.exitButton}>
          <CloseIcon
            width={16}
            height={16}
            color={colors.ds.typography.highEmphasis}
          />
        </TouchableOpacity>
        <View style={styles.titles}>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {sectionTitle}
          </Text>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {itemTitle}
          </Text>
        </View>
        <Text style={styles.progressText}>
          {t('courses.player.overallProgress', {pct: overallPct})}
        </Text>
      </View>
      {itemDescription ? (
        <Text style={styles.description} numberOfLines={2}>
          {htmlToPlainText(itemDescription)}
        </Text>
      ) : null}
      <SegmentedProgressRail
        sectionItems={sectionItems}
        currentItemId={currentItemId}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  header: {
    paddingHorizontal: '16@ms',
    paddingTop: '12@ms',
    paddingBottom: '10@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
    gap: '8@ms',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
  },
  exitButton: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  itemTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  description: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  progressText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
