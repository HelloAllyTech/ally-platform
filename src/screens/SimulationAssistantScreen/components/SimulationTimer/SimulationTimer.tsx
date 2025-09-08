import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {SimulationTimerProps} from '@/types';

export const SimulationTimer: React.FC<SimulationTimerProps> = ({
  startTime,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const {t} = useTranslation();

  useEffect(() => {
    const calculateInitialElapsed = () => {
      const now = new Date();
      return Math.floor(
        ((now > startTime ? now : startTime).getTime() - startTime.getTime()) /
          1000,
      );
    };

    setElapsedSeconds(calculateInitialElapsed());

    const interval = setInterval(() => {
      setElapsedSeconds(calculateInitialElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

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
    marginTop: '16@mvs',
    marginBottom: '6@mvs',
  },
  durationText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
  },
  durationValue: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@ms',
    color: colors.white,
  },
});
