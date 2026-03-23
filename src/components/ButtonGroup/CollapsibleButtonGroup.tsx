import React from 'react';
import {Animated, Easing, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronDown} from '@/assets';
import {DEFAULT_HIT_SLOP} from '@/constants';
import {colors} from '@/theme';

import {ButtonGroup} from './ButtonGroup';
import type {CollapsibleButtonGroupProps} from './types';

export const CollapsibleButtonGroup: React.FC<CollapsibleButtonGroupProps> = ({
  buttons,
  isMaximized,
  onToggleMaximized,
  chevronColor = colors.lightGrayD9,
  customContainerStyle,
  customButtonStyle,
  customButtonTextStyle,
  customToggleContainerStyle,
  headerContent,
  children,
  testID,
}) => {
  const animatedOpacity = React.useRef(new Animated.Value(0)).current;
  const chevronRotation = React.useRef(new Animated.Value(0)).current;
  const [contentHeight, setContentHeight] = React.useState(0);

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(animatedOpacity, {
        toValue: isMaximized ? 1 : 0,
        duration: 100,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.spring(chevronRotation, {
        toValue: isMaximized ? 0 : 1,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }),
    ]).start();
  }, [isMaximized, animatedOpacity, chevronRotation]);

  const rotateInterpolate = chevronRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View
      style={[styles.sectionContainer, customContainerStyle]}
      testID={testID}>
      <TouchableOpacity
        style={[styles.toggleIconContainer, customToggleContainerStyle]}
        onPress={onToggleMaximized}
        activeOpacity={0.8}
        hitSlop={DEFAULT_HIT_SLOP}
        testID={`${testID}-toggle`}>
        <Animated.View
          style={{
            transform: [{rotate: rotateInterpolate}],
          }}>
          <ChevronDown width={24} height={12} color={chevronColor} />
        </Animated.View>
      </TouchableOpacity>
      {isMaximized && (
        <Animated.View
          style={[
            styles.contentWrapper,
            {
              opacity: animatedOpacity,
            },
          ]}
          onLayout={e => {
            const {height} = e.nativeEvent.layout;
            if (contentHeight === 0) {
              setContentHeight(height);
            }
          }}>
          {headerContent}
          <ButtonGroup
            buttons={buttons}
            customButtonStyle={customButtonStyle}
            customButtonTextStyle={customButtonTextStyle}
          />
          {children}
        </Animated.View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  sectionContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: '8@mvs',
    paddingBottom: '6@mvs',
    paddingHorizontal: '16@ms',
    backgroundColor: colors.ds.blackAlpha[200],
  },
  contentWrapper: {
    width: '100%',
    overflow: 'hidden',
  },
  toggleIconContainer: {
    width: '48@ms',
    height: '32@mvs',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '12@mvs',
  },
});
