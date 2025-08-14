import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {SimulationTimerProps} from '@/types';

export const SimulationTimer: React.FC<SimulationTimerProps> = ({
  startTime,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
      <Text style={styles.sessionText}>
        Session in <Text style={styles.italicText}>progress</Text>
      </Text>
      <Text style={styles.timerText}>{formatTime(elapsedSeconds)}</Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  timerContainer: {
    alignItems: 'center',
    marginTop: '40@mvs',
  },
  sessionText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '22@ms',
    color: colors.black,
    marginBottom: '8@mvs',
  },
  italicText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontSize: '22@ms',
    color: colors.black,
  },
  timerText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '26@ms',
    color: colors.lightGray3,
  },
});
