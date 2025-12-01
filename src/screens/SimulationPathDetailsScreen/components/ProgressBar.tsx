import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

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
}

/**
 * ProgressBar Component
 *
 * A horizontal progress bar with inline text indicator.
 * Shows "X of Y completed" aligned to the right of the progress bar.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({current, total}) => {
  const {t} = useTranslate();
  const progressPercentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* Progress bar track */}
      <View style={styles.track}>
        {/* Progress bar fill */}
        <View
          style={[
            styles.fill,
            {
              width: `${progressPercentage}%`,
              backgroundColor:
                current >= total
                  ? colors.ds.green[400]
                  : colors.ds.theme.primary,
            },
          ]}
        />
      </View>
      {/* Progress text - inline with bar */}
      <Text style={styles.progressText}>
        {t('Simulations.progressCompleted', {current, total})}
      </Text>
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
    height: '6@ms',
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
