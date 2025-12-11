import {useCallback} from 'react';
import {
  NavigationProp,
  ParamListBase,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
import {useSelector} from 'react-redux';

import {useHardwareBackPressHandler} from '@/hooks';
import {getFirstVisibleTab} from '@/navigation/TabNavigator';
import {AppRootState} from '@/store/store';

/**
 * Custom hook to handle back press on tab root screens and navigate to the first visible tab.
 * Usage: Call this in any tab screen to make back go to first tab instead of exiting app.
 */
export const useTabBackToHomeHandler = () => {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const isFocused = useIsFocused();
  const permissions = useSelector((s: AppRootState) => s.user.permissions);

  useHardwareBackPressHandler(
    useCallback(() => {
      if (isFocused) {
        const firstTab = getFirstVisibleTab(permissions);
        navigation.navigate(firstTab);
        return true;
      }
      return false;
    }, [navigation, isFocused, permissions]),
  );
};
