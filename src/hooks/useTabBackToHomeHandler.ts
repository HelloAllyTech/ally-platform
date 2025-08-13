import {useCallback} from 'react';
import {useIsFocused} from '@react-navigation/native';

import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';

/**
 * Custom hook to handle back press on tab root screens and navigate to Home tab.
 * Usage: Call this in any tab screen to make back go to Home tab instead of exiting app.
 */
export const useTabBackToHomeHandler = () => {
  const navigation = useAppNavigation();
  const isFocused = useIsFocused();

  useHardwareBackPressHandler(
    useCallback(() => {
      if (isFocused) {
        navigation.navigate(SCREEN_NAMES.HOME, {
          screen: SCREEN_NAMES.BOTTOM_TABS,
          params: {screen: SCREEN_NAMES.HOME_TAB},
        });
        return true;
      }
      return false;
    }, [navigation, isFocused]),
  );
};
