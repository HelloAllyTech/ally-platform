import {FC, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {fontFamily} from '@/theme';

export interface SessionGoalTimerProps {
  startTime: string | Date;
  maxTimeValue: string; // HH:MM:SS
  isPaused?: boolean;
  pausedOffsetMs?: number;
}

export const SessionGoalTimer: FC<SessionGoalTimerProps> = ({
  startTime,
  maxTimeValue,
  isPaused = false,
  pausedOffsetMs = 0,
}) => {
  const [remainingTime, setRemainingTime] = useState<number>(0);
  const {t} = useTranslation();
  // Read pause state inside the interval without restarting it; exclude paused
  // time so "time remaining" doesn't tick down while the session is frozen.
  const isPausedRef = useRef(isPaused);
  const pausedOffsetMsRef = useRef(pausedOffsetMs);
  useEffect(() => {
    isPausedRef.current = isPaused;
    pausedOffsetMsRef.current = pausedOffsetMs;
  });

  // Convert maxTimeValue (HH:MM:SS) to seconds
  const parseTimeValue = (timeStr: string): number => {
    if (!timeStr) {
      return 0;
    }
    const parts = timeStr.split(':').map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return hours * 3600 + minutes * 60 + seconds;
  };

  const maxTimeSeconds = parseTimeValue(maxTimeValue);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return hours > 0
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  };

  useEffect(() => {
    if (!startTime || !maxTimeSeconds) {
      return () => {};
    }

    const updateTimer = () => {
      if (isPausedRef.current) return;
      const now = Date.now();
      const start =
        startTime instanceof Date ? startTime.getTime() : Date.parse(startTime);
      const timeElapsed = Math.floor(
        (now - start - pausedOffsetMsRef.current) / 1000,
      );
      const remaining = Math.max(0, maxTimeSeconds - timeElapsed);
      setRemainingTime(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [startTime, maxTimeSeconds]);

  // Format remaining time text
  const remainingMinutes = Math.floor(remainingTime / 60);
  const remainingSeconds = remainingTime % 60;
  const remainingMinutesText = `${remainingMinutes} ${t('simulationPage.min')} ${remainingSeconds} ${t('simulationPage.sec')}`;

  // Calculate progress percentage (0 to 100)
  const progressPercentage =
    maxTimeSeconds > 0
      ? Math.max(
          0,
          Math.min(
            100,
            ((maxTimeSeconds - remainingTime) / maxTimeSeconds) * 100,
          ),
        )
      : 0;

  const getGradientColors = () => {
    if (remainingTime <= 300) {
      if (remainingTime <= 60) {
        return ['#ef4444', '#ef4444']; // Red -> text-red-500
      }
      return ['#E77625', '#E77625']; // Orange
    }
    return ['#264D8E', '#264D8E']; // Blue
  };

  const getRemainingTextColor = () => {
    if (remainingTime > 0) {
      if (remainingTime <= 300) {
        if (remainingTime <= 60) {
          return '#ef4444';
        }
        return '#E77625';
      }
      return '#4ade80'; // green-400
    }
    return '#cbd5e1'; // slate-300
  };

  return (
    <View style={styles.container} testID="session-goal-timer">
      {/* Progress bar background */}
      <View style={styles.progressBarBackground}>
        <LinearGradient
          colors={getGradientColors()}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 0}}
          style={[styles.progressBarFill, {width: `${progressPercentage}%`}]}
        />
      </View>

      {/* Timer info section */}
      <View style={styles.infoContainer}>
        <View style={styles.leftInfo}>
          <Text style={styles.label} testID="session-goal-timer-label">
            {t('simulationPage.sessionTimer')}
          </Text>
          <Text
            style={styles.maxTimeValue}
            testID="session-goal-timer-max-time">
            {formatTime(maxTimeSeconds)}
          </Text>
        </View>

        <View style={styles.rightInfo}>
          <Text style={styles.label}>{t('simulationPage.timeRemaining')}</Text>
          <Text
            testID="session-goal-timer-remaining"
            style={[
              styles.remainingTimeValue,
              {color: getRemainingTextColor()},
            ]}>
            {remainingMinutesText}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: '4@ms',
    marginBottom: '8@vs',
  },
  progressBarBackground: {
    width: '100%',
    height: '14@vs',
    backgroundColor: '#94a3b8', // slate-400
    borderRadius: '8@ms',
    overflow: 'hidden',
    marginBottom: '6@vs',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: '8@ms',
  },
  infoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: '4@ms',
  },
  leftInfo: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2@vs',
  },
  rightInfo: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2@vs',
  },
  label: {
    fontSize: '10@ms',
    color: '#94a3b8', // slate-400
    fontWeight: '500',
    letterSpacing: 0.5,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  maxTimeValue: {
    fontSize: '14@ms',
    color: '#ffffff',
    fontWeight: 'bold',
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM, // Using MEDIUM as close to Bold
  },
  remainingTimeValue: {
    fontSize: '14@ms',
    fontWeight: 'bold',
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
  },
});
