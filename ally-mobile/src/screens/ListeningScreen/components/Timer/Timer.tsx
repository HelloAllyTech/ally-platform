import React, {useEffect, useState} from 'react';
import {Text} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

interface TimerProps {
  startTime: number; // timestamp in milliseconds
}

export const Timer: React.FC<TimerProps> = ({startTime}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
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
  }, [startTime]);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return <Text style={styles.timer}>{formatTime(elapsedSeconds)}</Text>;
};

const styles = ScaledSheet.create({
  timer: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    lineHeight: '20.8@ms',
    letterSpacing: 0,
    color: colors.white,
    textAlign: 'center',
  },
});
