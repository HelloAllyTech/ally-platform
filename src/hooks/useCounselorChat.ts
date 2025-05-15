import {useCallback, useEffect, useRef} from 'react';
import {useRoute} from '@react-navigation/native';
import {AppState, AppStateStatus} from 'react-native';

import {useLazyGetCounsellorChatQuery} from '@/services/chatApi';
import {useAppDispatch} from '@/store/hooks';
import {setCurrentChat} from '@/store/slices/chatSlice';
import {logger} from '@/utils/logger';

import {useAppNavigation} from './useAppNavigation';

export const useCounselorChat = () => {
  const navigation = useAppNavigation();
  const route = useRoute();

  const dispatch = useAppDispatch();
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const appState = useRef(AppState.currentState);
  const isCheckingRef = useRef(false);

  const checkCounselorChat = useCallback(async () => {
    // Prevent multiple simultaneous checks
    if (isCheckingRef.current) return;

    try {
      isCheckingRef.current = true;
      const {data, error} = await getCounsellorChat();
      if (data) {
        dispatch(setCurrentChat(data));
        if (route.name === 'Splash') {
          // Reset the navigation stack to have Home and Listening screens
          navigation.reset({
            index: 1,
            routes: [{name: 'Home'}, {name: 'Listening'}],
          });
        } else {
          // From other screens, just navigate to Listening
          navigation.navigate('Listening');
        }
      } else if (error && 'status' in error && error.status === 404) {
        // Only navigate to Home if we're on the Splash screen
        if (route.name === 'Splash') {
          navigation.replace('Home');
        }
      }
    } catch (error) {
      logger.error(`Error checking counselor chat: ${error}`);
    } finally {
      isCheckingRef.current = false;
    }
  }, [dispatch, getCounsellorChat, navigation, route.name]);

  const handleAppStateChange = useCallback(
    async (nextAppState: AppStateStatus) => {
      // Check if app is coming to foreground
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        await checkCounselorChat();
      }
      appState.current = nextAppState;
    },
    [checkCounselorChat],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [handleAppStateChange]);

  return {
    checkCounselorChat,
  };
};
