import {useEffect, useRef} from 'react';
import {NavigationContainerRef} from '@react-navigation/native';

import {RootStackParamList, RouteNames} from '@/navigation/types';
import {logger} from '@/utils/logger';

import {useAppNavigation} from './useAppNavigation';
import {useCounselorChat} from './useCounselorChat';

export const useNavigationAwareCounselorChat = (
  navigationRef: NavigationContainerRef<RootStackParamList>,
) => {
  const navigation = useAppNavigation();
  const currentRouteName = useRef<RouteNames | undefined>(null);

  // Keep track of the current screen
  useEffect(() => {
    const unsubscribe = navigationRef?.addListener('state', () => {
      const currentRoute = navigationRef?.getCurrentRoute();
      currentRouteName.current = currentRoute?.name as RouteNames;
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigationRef]);

  return useCounselorChat({
    onActiveChatFound: () => {
      // Handle active chat found based on current screen
      switch (currentRouteName.current) {
        case 'Splash':
          // From splash, reset stack to Home -> Listening
          navigation.reset({
            index: 1,
            routes: [{name: 'Home'}, {name: 'Listening'}],
          });
          break;

        case 'Listening':
          // Already in chat flow, no navigation needed
          logger.info('Active chat found but already in chat flow');
          break;
        default:
          navigation.navigate('Listening');
          break;
      }
    },
    // Always subscribe to AppState changes
    shouldSubscribeToAppState: true,
  });
};
