import {useCallback, useMemo} from 'react';
import {useRoute} from '@react-navigation/native';

import {getFirstVisibleTab} from '@/navigation/TabNavigator';
import {useAppSelector} from '@/store/hooks';
import {AppRootState} from '@/store/store';

import {useDrawerNavigation} from './useDrawerNavigation';

/**
 * Custom hook for tab screen headers with hamburger menu
 * Returns whether to show hamburger and handler to open drawer
 */
export const useTabScreenHeader = () => {
  const {permissions} = useAppSelector((state: AppRootState) => state.user);
  const route = useRoute();
  const drawerNavigation = useDrawerNavigation();

  // Check if this is the first visible tab
  const isFirstTab = useMemo(() => {
    const firstTab = getFirstVisibleTab(permissions);
    return route.name === firstTab;
  }, [permissions, route.name]);

  const handleOpenDrawer = useCallback(() => {
    drawerNavigation.openDrawer();
  }, [drawerNavigation]);

  return {
    showHamburger: isFirstTab,
    handleOpenDrawer,
  };
};
