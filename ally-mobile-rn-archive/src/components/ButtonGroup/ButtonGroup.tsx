import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ButtonItem} from './ButtonItem';
import type {ButtonGroupProps} from './types';

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  buttons,
  customContainerStyle,
  customButtonStyle,
  customButtonTextStyle,
  testID,
}) => {
  return (
    <View style={[styles.container, customContainerStyle]} testID={testID}>
      {buttons.map((button, index) => (
        <ButtonItem
          key={button.id}
          button={button}
          customStyle={customButtonStyle}
          customTextStyle={customButtonTextStyle}
          isLast={index === buttons.length - 1}
        />
      ))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    gap: '8@s',
  },
});
