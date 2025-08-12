import {useCallback} from 'react';
import {useIsFocused} from '@react-navigation/native';

import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';

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
        navigation.navigate('CallLog');
        return true;
      }
      return false;
    }, [navigation, isFocused]),
  );
};
