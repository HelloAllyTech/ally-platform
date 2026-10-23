import React from 'react';
import {StyleProp, Text, TouchableOpacity, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

import {CircularProgress} from '../CircularProgress';

export interface LevelIndicatorProps {
  level: number;
  /** 0..1 fill toward the next level. */
  progress: number;
  /** At the top of the ladder the ring is permanently full and switches colour. */
  isMaxLevel?: boolean;
  /** Full sentence for assistive tech — a ring and a bare number say nothing alone. */
  accessibilityLabel: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const RING_SIZE = 33;
const RING_STROKE = 3;
/** CircularProgress works in absolute units, so 0..1 is scaled onto a 0..100 track. */
const PROGRESS_SCALE = 100;

/**
 * Compact level ring for the persistent header slot.
 *
 * Reuses CircularProgress rather than drawing another ring: it already handles the
 * animated stroke and takes centre content, and matching its 33px/3px geometry keeps this
 * visually identical to the course-progress rings the learner already sees.
 */
export const LevelIndicator: React.FC<LevelIndicatorProps> = ({
  level,
  progress,
  isMaxLevel = false,
  accessibilityLabel,
  onPress,
  style,
}) => {
  const safeProgress = Number.isFinite(progress)
    ? Math.min(Math.max(progress, 0), 1)
    : 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={accessibilityLabel}
      testID="level-indicator"
      style={style}>
      <CircularProgress
        progress={safeProgress * PROGRESS_SCALE}
        max={PROGRESS_SCALE}
        size={RING_SIZE}
        strokeWidth={RING_STROKE}
        progressColor={isMaxLevel ? colors.ds.green[400] : colors.blue}>
        <Text style={styles.levelText}>{level}</Text>
      </CircularProgress>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  levelText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
  },
});
