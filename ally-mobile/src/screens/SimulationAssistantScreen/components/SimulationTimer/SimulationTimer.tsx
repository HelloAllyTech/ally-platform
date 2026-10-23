import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {WARNING_THRESHOLD_SECONDS} from '@/constants';
import {colors, fontFamily} from '@/theme';
import {SimulationTimerProps} from '@/types';

// The agent authoritatively ends the session at the limit; this client auto-end
// is a fallback only (fires a bit past the limit if the agent failed to end).
const CLIENT_AUTO_END_GRACE_SECONDS = 15;

export const SimulationTimer: React.FC<SimulationTimerProps> = ({
  startTime,
  timeLimit,
  onWarning,
  onTimeLimit,
  isPaused = false,
  pausedOffsetMs = 0,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const {t} = useTranslation();
  const hasWarnedRef = useRef(false);
  const onWarningRef = useRef(onWarning);
  const onTimeLimitRef = useRef(onTimeLimit);
  // Read pause state inside the interval without restarting it on every change.
  const isPausedRef = useRef(isPaused);
  const pausedOffsetMsRef = useRef(pausedOffsetMs);

  useEffect(() => {
    onWarningRef.current = onWarning;
    onTimeLimitRef.current = onTimeLimit;
    isPausedRef.current = isPaused;
    pausedOffsetMsRef.current = pausedOffsetMs;
  });

  useEffect(() => {
    hasWarnedRef.current = false;

    const interval = setInterval(() => {
      // While paused, hold the displayed time and don't advance the limit —
      // paused time must not count toward the scenario time limit.
      if (isPausedRef.current) {
        return;
      }
      const now = Date.now();
      const elapsed = Math.floor(
        (now - startTime.getTime() - pausedOffsetMsRef.current) / 1000,
      );
      setElapsedSeconds(elapsed);

      if (timeLimit !== undefined) {
        if (
          timeLimit - elapsed <= WARNING_THRESHOLD_SECONDS &&
          !hasWarnedRef.current
        ) {
          onWarningRef.current?.();
          hasWarnedRef.current = true;
        }

        if (elapsed >= timeLimit + CLIENT_AUTO_END_GRACE_SECONDS) {
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
        {t('simulationPage.sessionDuration')}: {''}
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
