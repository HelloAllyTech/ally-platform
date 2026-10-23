import {useEffect, useRef} from 'react';
import {NavigationContainerRef} from '@react-navigation/native';

import {SCREEN_NAMES} from '@/constants';
import {RootStackParamList, RouteNames} from '@/navigation';
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
    getCurrentRoute: () => currentRouteName.current as RouteNames | undefined,
    onActiveChatFound: () => {
      // Handle active chat found based on current screen
      switch (currentRouteName.current) {
        case SCREEN_NAMES.SPLASH:
          // From splash, reset stack to Call Logs -> Listening
          navigation.reset({
            index: 1,
            routes: [
              {name: SCREEN_NAMES.CALL_LOG},
              {name: SCREEN_NAMES.LISTENING},
            ],
          });
          break;

        case SCREEN_NAMES.LISTENING:
          // Already in chat flow, no navigation needed
          logger.info('Active chat found but already in chat flow');
          break;
        default:
          navigation.navigate(SCREEN_NAMES.LISTENING);
          break;
      }
    },
    // Always subscribe to AppState changes
    shouldSubscribeToAppState: true,
  });
};
