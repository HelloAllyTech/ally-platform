import {useEffect} from 'react';
import {useNavigation} from '@react-navigation/native';
import {BackHandler} from 'react-native';

type BackHandlerCallback = () => boolean | null | undefined;

/**
 * Custom hook to handle hardware back press events
 * @param callback Optional callback to handle back press. Return true to prevent default behavior
 * @returns void
 *
 * @example
 * // Exit app on back press (for Call Logs screen)
 * useHardwareBackPressHandler(() => {
 *   BackHandler.exitApp();
 *   return true;
 * });
 *
 * // Prevent back navigation
 * useHardwareBackPressHandler(() => true);
 *
 * // Custom back behavior
 * useHardwareBackPressHandler(() => {
 *   // Custom logic
 *   return true; // Prevents default back behavior
 * });
 */
export const useHardwareBackPressHandler = (callback?: BackHandlerCallback) => {
  const navigation = useNavigation();

  useEffect(() => {
    const handleBackPress = () => {
      // If custom callback provided, use it
      if (callback) {
        const result = callback();
        if (result) return true;
      }

      // If we can go back, do it
      if (navigation.canGoBack()) {
        navigation.goBack();
        return true;
      }

      // Default to system behavior
      return false;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackPress,
    );

    return () => subscription.remove();
  }, [callback, navigation]);
};
