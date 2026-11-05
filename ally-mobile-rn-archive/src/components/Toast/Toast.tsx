import React, {useEffect} from 'react';
import {Text, View} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

import {ToastPosition, ToastType} from './ToastProvider';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onHide?: () => void;
  position?: ToastPosition;
}

const TOAST_STYLES = {
  success: {
    background: colors.ds.green[50],
    border: colors.ds.green[700],
    text: colors.ds.green[800],
  },
  error: {
    background: colors.ds.red[50],
    border: colors.ds.red[500],
    text: colors.ds.red[500],
  },
} as const;

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  duration = 3000,
  position = 'bottom',
  onHide,
}) => {
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, {damping: 15, stiffness: 120});
    opacity.value = withTiming(1, {duration: 300});

    const timer = setTimeout(() => {
      translateY.value = withSpring(100, {damping: 15, stiffness: 120});
      opacity.value = withTiming(0, {duration: 300});
      onHide?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onHide, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{translateY: translateY.value}],
    opacity: opacity.value,
  }));

  const variant = TOAST_STYLES[type] ?? TOAST_STYLES.success;

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        position === 'top' ? styles.top : styles.bottom,
      ]}>
      <View
        style={[
          styles.toast,
          {
            backgroundColor: variant.background,
            borderColor: variant.border,
          },
        ]}>
        <Text style={[styles.message, {color: variant.text}]}>{message}</Text>
      </View>
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    left: '20@ms',
    right: '20@ms',
    alignItems: 'center',
    zIndex: 999999,
  },
  top: {top: '100@ms'},
  bottom: {bottom: '100@ms'},
  toast: {
    padding: '12@ms',
    borderRadius: '8@ms',
    minWidth: '200@ms',
    maxWidth: '90%',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    elevation: 2,
    borderWidth: 0.5,
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    textAlign: 'center',
  },
});
