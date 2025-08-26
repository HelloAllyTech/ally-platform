import {useCallback} from 'react';
import {useIsFocused} from '@react-navigation/native';

import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';

/**
 * Custom hook to handle back press on tab root screens and navigate to Call Logs tab.
 * Usage: Call this in any tab screen to make back go to Call Logs tab instead of exiting app.
 */
export const useTabBackToHomeHandler = () => {
  const navigation = useAppNavigation();
  const isFocused = useIsFocused();

  useHardwareBackPressHandler(
    useCallback(() => {
      if (isFocused) {
        navigation.navigate(SCREEN_NAMES.CALL_LOG);
        return true;
      }
      return false;
    }, [navigation, isFocused]),
  );
};
