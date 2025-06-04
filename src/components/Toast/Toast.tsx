import React, {useEffect} from 'react';
import {Text, View} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onHide?: () => void;
  position?: 'top' | 'bottom';
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  duration = 3000,
  position = 'bottom',
  onHide,
}) => {
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, {
      damping: 15,
      stiffness: 120,
    });
    opacity.value = withTiming(1, {duration: 300});

    const timer = setTimeout(() => {
      translateY.value = withSpring(100, {
        damping: 15,
        stiffness: 120,
      });
      opacity.value = withTiming(0, {duration: 300});
      onHide?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onHide, opacity, translateY]);

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return colors.teal;
      case 'error':
        return colors.vividRed;
      default:
        return colors.azureBlue;
    }
  };

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{translateY: translateY.value}],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        position === 'top' ? styles.top : styles.bottom,
      ]}>
      <View style={[styles.toast, {backgroundColor: getBackgroundColor()}]}>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    bottom: '20@ms',
    left: '20@ms',
    right: '20@ms',
    alignItems: 'center',
    zIndex: 9999,
  },
  top: {
    top: '100@ms',
  },
  bottom: {
    bottom: '100@ms',
  },
  toast: {
    padding: '12@ms',
    borderRadius: '8@ms',
    minWidth: '200@ms',
    maxWidth: '90%',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  message: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.white,
    fontSize: '14@ms',
    textAlign: 'center',
  },
});
