import React, {useEffect, useRef} from 'react';
import {Animated, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {isIOS, SCREEN_WIDTH} from '@/constants/general';
import {colors, fontFamily} from '@/theme';

export interface CustomMenuModalOption {
  label: string;
  iconRight: React.ReactNode;
  onPress: () => void;
}

interface CustomMenuModalProps {
  visible: boolean;
  onClose: () => void;
  options: CustomMenuModalOption[];
}

export const CustomMenuModal: React.FC<CustomMenuModalProps> = ({
  visible,
  options,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, fadeAnim]);

  const renderCustomMenuOption = (
    option: CustomMenuModalOption,
    index: number,
  ) => {
    return (
      <React.Fragment key={index}>
        <TouchableOpacity
          key={index}
          style={styles.menuItem}
          onPress={option.onPress}>
          <Text style={styles.menuText}>{option.label}</Text>
          {option.iconRight}
        </TouchableOpacity>
        {index < options.length - 1 && <View style={styles.menuDivider} />}
      </React.Fragment>
    );
  };

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
          },
        ]}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.menuContainer,
          {
            marginTop: insets.top + 60,
            width: Math.min(200, SCREEN_WIDTH * 0.7),
            opacity: fadeAnim,
            transform: [
              {
                translateY: fadeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-10, 0],
                }),
              },
            ],
          },
          !isIOS && styles.androidShadow,
        ]}>
        {options.map((option, index) => renderCustomMenuOption(option, index))}
      </Animated.View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.whiteTransparent10,
  },
  overlayTouchable: {
    flex: 1,
  },
  menuContainer: {
    position: 'absolute',
    right: ms(20),
    backgroundColor: colors.white,
    borderRadius: ms(8),
    paddingVertical: ms(4),
    shadowColor: colors.darkGray,
    shadowOffset: {width: 0, height: ms(2)},
    shadowOpacity: 0.2,
    shadowRadius: ms(8),
    elevation: 5,
    minWidth: ms(200),
  },
  androidShadow: {
    elevation: 8,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: ms(4)},
    shadowOpacity: 0.3,
    shadowRadius: ms(4.65),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: ms(8),
    paddingHorizontal: ms(20),
    minHeight: ms(44),
  },
  menuText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(15),
    color: colors.black,
  },
  menuDivider: {
    height: ms(0.5),
    backgroundColor: colors.lightGray2,
    marginHorizontal: ms(10),
  },
});
