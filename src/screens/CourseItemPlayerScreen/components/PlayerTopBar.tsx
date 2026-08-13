import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import type {FlatTrackItem} from '@/hooks/useTrackPlayerNavigation';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {SegmentedProgressRail} from './SegmentedProgressRail';

export interface PlayerTopBarProps {
  sectionTitle: string;
  sectionItems: FlatTrackItem[];
  currentItemId: string;
  overallPct: number;
  onExit: () => void;
}

/**
 * Full-screen player header: exit button, current section title, the
 * segmented progress rail for the section, and the overall completion %.
 * Mirrors ally-web's `PlayerTopBar`.
 */
export const PlayerTopBar: React.FC<PlayerTopBarProps> = ({
  sectionTitle,
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
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {sectionTitle}
        </Text>
        <Text style={styles.progressText}>
          {t('courses.player.overallProgress', {pct: overallPct})}
        </Text>
      </View>
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
  sectionTitle: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  progressText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
