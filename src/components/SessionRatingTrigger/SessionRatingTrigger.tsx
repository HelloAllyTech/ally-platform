import React, {useState} from 'react';
import {TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {StarIcon} from '@/assets';
import {colors} from '@/theme';

import type {SessionRatingTriggerProps} from './types';

const SIZE_MAP = {sm: 20, md: 24};

export const SessionRatingTrigger: React.FC<SessionRatingTriggerProps> = ({
  value,
  onSelect,
  size = 'md',
}) => {
  const [pressed, setPressed] = useState(0);
  const starSize = SIZE_MAP[size];
  const displayValue = pressed || value;

  return (
    <View style={styles.container}>
      {[1, 2, 3, 4, 5].map(star => (
        <TouchableOpacity
          key={star}
          onPressIn={() => setPressed(star)}
          onPressOut={() => setPressed(0)}
          onPress={() => onSelect?.(star)}
          accessibilityRole="button"
          accessibilityLabel={`${star} of 5 stars`}
          accessibilityState={{selected: star === value}}
          style={styles.star}>
          <StarIcon
            width={starSize}
            height={starSize}
            color={star <= displayValue ? colors.starYellow : colors.lightGray4}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  star: {
    padding: '2@ms',
  },
});
