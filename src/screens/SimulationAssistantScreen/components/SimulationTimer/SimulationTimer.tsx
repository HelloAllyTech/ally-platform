import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

interface SimulationTimerProps {
  startTime: number;
  isConnected: boolean;
}

export const SimulationTimer: React.FC<SimulationTimerProps> = ({
  startTime,
  isConnected,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isConnected) {
      setElapsedSeconds(0);
      return;
    }

    const calculateInitialElapsed = () => {
      const now = Date.now();
      return Math.floor(
        ((now > startTime ? now : startTime) - startTime) / 1000,
      );
    };

    setElapsedSeconds(calculateInitialElapsed());

    const interval = setInterval(() => {
      setElapsedSeconds(calculateInitialElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isConnected]);

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
    fontSize: '18@ms',
    color: colors.black,
    marginBottom: '8@mvs',
  },
  italicText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontSize: '18@ms',
    color: colors.black,
  },
  timerText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '16@ms',
    color: colors.lightGray3,
  },
});
