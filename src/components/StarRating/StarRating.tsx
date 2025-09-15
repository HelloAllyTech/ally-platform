import React from 'react';
import {TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {StarIcon} from '@/assets';
import {colors} from '@/theme';

import type {StarRatingProps} from './types';

export const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onRatingChange,
  size = 30,
  testID,
  customContainerStyle,
}) => {
  const renderStar = (index: number) => {
    const isFilled = index < rating;

    return (
      <TouchableOpacity
        key={index}
        onPress={() => onRatingChange(index + 1)}
        style={styles.starContainer}
        testID={`${testID}-star-${index + 1}`}>
        <StarIcon
          width={size}
          height={size}
          color={isFilled ? colors.starYellow : colors.lightGray4}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, customContainerStyle]} testID={testID}>
      {Array.from({length: 5}, (_, index) => renderStar(index))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: '8@vs',
  },
  starContainer: {
    marginHorizontal: '4@ms',
  },
  star: {
    borderRadius: '12@ms',
  },
});
