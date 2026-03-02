import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {WARNING_THRESHOLD_SECONDS} from '@/constants';
import {colors, fontFamily} from '@/theme';
import {SimulationTimerProps} from '@/types';

export const SimulationTimer: React.FC<SimulationTimerProps> = ({
  startTime,
  timeLimit,
  onWarning,
  onTimeLimit,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const {t} = useTranslation();
  const hasWarnedRef = useRef(false);
  const onWarningRef = useRef(onWarning);
  const onTimeLimitRef = useRef(onTimeLimit);

  useEffect(() => {
    onWarningRef.current = onWarning;
    onTimeLimitRef.current = onTimeLimit;
  });

  useEffect(() => {
    hasWarnedRef.current = false;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime.getTime()) / 1000);
      setElapsedSeconds(elapsed);

      if (timeLimit !== undefined) {
        if (
          timeLimit - elapsed <= WARNING_THRESHOLD_SECONDS &&
          !hasWarnedRef.current
        ) {
          onWarningRef.current?.();
          hasWarnedRef.current = true;
        }

        if (elapsed >= timeLimit) {
          onTimeLimitRef.current?.();
          clearInterval(interval);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, timeLimit]);

  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  return (
    <View style={styles.timerContainer}>
      <Text style={styles.durationText}>
        {t('SimulationAssistant.sessionDuration')}: {''}
        <Text style={styles.durationValue}>{formatTime(elapsedSeconds)}</Text>
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  timerContainer: {
    alignItems: 'center',
    marginVertical: '8@vs',
  },
  durationText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
  },
  durationValue: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    color: colors.white,
  },
});
