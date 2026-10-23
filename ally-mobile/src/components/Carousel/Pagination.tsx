import React from 'react';
import {TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

import type {PaginationProps} from './types';

export const Pagination: React.FC<PaginationProps> = ({
  totalItems,
  currentIndex,
  style,
  inactiveDotStyle,
  activeDotStyle,
}) => {
  if (totalItems <= 1) return null;

  return (
    <View style={[styles.container, style]} testID="pagination-container">
      {Array.from({length: totalItems}, (_, index) => (
        <TouchableOpacity
          key={index}
          testID={`pagination-dot-${index}`}
          style={[
            styles.dot,
            inactiveDotStyle,
            index === currentIndex ? [styles.activeDot, activeDotStyle] : [],
          ]}
          activeOpacity={0.7}
        />
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '8@vs',
  },
  dot: {
    width: '8@ms',
    height: '2@ms',
    backgroundColor: colors.lightGray4,
    marginHorizontal: '3@ms',
  },
  activeDot: {
    backgroundColor: colors.azureBlue,
    width: '8@ms',
    height: '2@ms',
  },
});
