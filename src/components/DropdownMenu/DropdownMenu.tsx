import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Text, TouchableOpacity, View, ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {isIOS, SCREEN_WIDTH} from '@/constants';
import {colors, fontFamily} from '@/theme';

import {DropdownMenuItem, DropdownMenuProps} from './types';

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  visible,
  onClose,
  items,
  containerOffsetTop = 70,
  containerOffsetX = -Math.min(SCREEN_WIDTH * 0.32, 125),
  width = Math.min(250, SCREEN_WIDTH * 0.7),
}) => {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, fadeAnim]);

  const menuContainerStyle = useMemo(() => {
    const marginTop = insets.top + containerOffsetTop;
    const style: ViewStyle = {
      marginTop,
      width,
      opacity: fadeAnim as unknown as number,
      transform: [
        {
          translateY: fadeAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [-10, 0],
          }) as unknown as number,
        },
        {translateX: containerOffsetX},
      ],
    } as unknown as ViewStyle;

    return [styles.menuContainer, style, !isIOS && styles.androidShadow];
  }, [fadeAnim, insets.top, containerOffsetTop, containerOffsetX, width]);

  const overlayStyle = useMemo(
    () => [styles.overlay, {opacity: fadeAnim}],
    [fadeAnim],
  );

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Animated.View style={overlayStyle}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
        />
      </Animated.View>

      <Animated.View style={menuContainerStyle}>
        {items.map((item: DropdownMenuItem, idx: number) => (
          <View key={`${idx}-${item.text}`}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                item.onPress();
                onClose();
              }}
              activeOpacity={0.8}
              disabled={item.disabled}>
              <View style={styles.textContainer}>
                {item.icon}
                <Text style={styles.menuText}>{item.text}</Text>
              </View>
              {item.isSelected && item.selectedIcon}
            </TouchableOpacity>
            {idx < items.length - 1 && <View style={styles.menuDivider} />}
          </View>
        ))}
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
  textContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
  },
  menuContainer: {
    position: 'absolute',
    left: '50%',
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    paddingHorizontal: '14@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    shadowColor: colors.lightGray5,
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.7,
    shadowRadius: 6,
    elevation: 5,
  },
  androidShadow: {
    elevation: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '14@ms',
  },
  menuText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
  },
  menuDivider: {
    borderBottomWidth: 0.5,
    borderColor: colors.lightGray4,
  },
});
