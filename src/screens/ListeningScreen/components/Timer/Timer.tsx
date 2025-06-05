import React, {useEffect, useState} from 'react';
import {StyleProp, Text, TextStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface TimerProps {
  startTime: number; // timestamp in milliseconds
  customStyle?: StyleProp<TextStyle>;
}

export const Timer: React.FC<TimerProps> = ({startTime, customStyle = {}}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const calculateInitialElapsed = () => {
      const now = Date.now();
      return Math.floor((now - startTime) / 1000);
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

  return (
    <Text style={[styles.timer, customStyle]}>
      {formatTime(elapsedSeconds)}
    </Text>
  );
};

const styles = ScaledSheet.create({
  timer: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '22@ms',
    lineHeight: '28@ms',
    letterSpacing: 0,
    color: colors.white,
  },
});
