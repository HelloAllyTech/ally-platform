import {Platform, Vibration} from 'react-native';

/**
 * Trigger haptic feedback on iOS devices
 * @param {string} type - Type of haptic feedback ('impact', 'selection', 'notification')
 * @param {object} options - Options for haptic feedback
 */
export const triggerHapticFeedback = () => {
  if (Platform.OS === 'ios') {
    // On iOS, use basic vibration as fallback
    Vibration.vibrate(50);
  } else if (Platform.OS === 'android') {
    // On Android, use vibration
    Vibration.vibrate(50);
  }
};

/**
 * Check if haptic feedback is available
 * @returns {boolean} True if haptic feedback is available
 */
export const isHapticFeedbackAvailable = () => {
  return true;
};
