import React from 'react';
import {StyleProp, Text, TextStyle, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

export interface ProgressBarProps {
  /**
   * Current progress value
   */
  current: number;
  /**
   * Total/maximum value
   */
  total: number;
  /**
   * Color of the progress bar
   */
  inProgressColor?: string;
  /**
   * Color of the completed progress bar
   */
  completedColor?: string;
  /**
   * Height of the progress bar
   */
  height?: number;
  /**
   * Whether to show the progress text
   */
  isProgressTextVisible?: boolean;
  /**
   *  Progress bar text
   */
  progressText?: string;
  /**
   * Style of the progress bar text
   */
  progressTextStyle?: StyleProp<TextStyle>;
}

/**
 * ProgressBar Component
 *
 * A horizontal progress bar with inline text indicator.
 * Shows "X of Y completed" aligned to the right of the progress bar.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  current,
  total,
  inProgressColor = colors.ds.theme.primary,
  completedColor = colors.ds.green[400],
  height = ms(6),
  isProgressTextVisible = true,
  progressText,
  progressTextStyle,
}) => {
  const {t} = useTranslate();
  const progressPercentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* Progress bar track */}
      <View style={[styles.track, {height: height}]}>
        {/* Progress bar fill */}
        <View
          style={[
            styles.fill,
            {
              width: `${progressPercentage}%`,
              backgroundColor:
                current >= total ? completedColor : inProgressColor,
            },
          ]}
        />
      </View>
      {/* Progress text - inline with bar */}
      {isProgressTextVisible && (
        <Text style={[styles.progressText, progressTextStyle]}>
          {progressText || t('simulations.progressCompleted', {current, total})}
        </Text>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    gap: '10@ms',
  },
  track: {
    flex: 1,
    backgroundColor: colors.ds.grey[200],
    borderRadius: '3@ms',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.ds.theme.primary,
    borderRadius: '3@ms',
  },
  progressText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
