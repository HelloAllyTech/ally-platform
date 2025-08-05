import {useCallback} from 'react';
import {useIsFocused} from '@react-navigation/native';

import {useAppNavigation} from '@/hooks/useAppNavigation';
import {useHardwareBackPressHandler} from '@/hooks/useHardwareBackPressHandler';

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
        navigation.navigate('Home', {
          screen: 'BottomTabs',
          params: {screen: 'HomeTab'},
        });
        return true;
      }
      return false;
    }, [navigation, isFocused]),
  );
};
