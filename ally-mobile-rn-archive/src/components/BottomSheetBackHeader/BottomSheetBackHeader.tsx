import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ms} from 'react-native-size-matters';

import {LeftArrow} from '@/assets/icons';
import {colors} from '@/theme';

import {styles} from './styles';

interface BottomSheetBackHeaderProps {
  title: string;
  onBack: () => void;
}

export const BottomSheetBackHeader: React.FC<BottomSheetBackHeaderProps> =
  React.memo(({title, onBack}) => {
    return (
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}>
          <LeftArrow
            width={ms(12)}
            height={ms(15)}
            color={colors.ds.typography.highEmphasis}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>
    );
  });

BottomSheetBackHeader.displayName = 'BottomSheetBackHeader';
