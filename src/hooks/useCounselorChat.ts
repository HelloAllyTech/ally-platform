import {useCallback, useEffect, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';

import {RouteNames} from '@/navigation/types';
import {useLazyGetCounsellorChatQuery} from '@/services/chatApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat, setCurrentChat} from '@/store/slices/chatSlice';
import {Chat} from '@/types/message';
import {UserRole} from '@/types/user';

interface UseCounselorChatProps {
  onActiveChatFound?: (data: Chat) => void;
  onNoActiveChatFound?: (error: unknown) => void;
  shouldSubscribeToAppState?: boolean;
  getCurrentRoute?: () => string | undefined;
}

export const useCounselorChat = ({
  onActiveChatFound,
  onNoActiveChatFound,
  shouldSubscribeToAppState = false,
  getCurrentRoute,
}: UseCounselorChatProps = {}) => {
  const userData = useAppSelector(state => state.user);
  const dispatch = useAppDispatch();
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const appState = useRef(AppState.currentState);
  const isCheckingRef = useRef(false);

  const checkCounselorChat = useCallback(async () => {
    // Prevent multiple simultaneous checks
    if (!userData?.isAuthenticated || isCheckingRef.current) return;

    try {
      isCheckingRef.current = true;
      const {data, error} = await getCounsellorChat();

      // If data is a non-empty object (active chat), dispatch and notify
      if (data && !Array.isArray(data)) {
        dispatch(setCurrentChat(data));
        onActiveChatFound?.(data);
      } else {
        // Check if we should preserve chat based on current route
        const currentRoute = getCurrentRoute?.() as RouteNames;
        const shouldPreserveChat =
          currentRoute === 'Breathing' || currentRoute === 'CallSummary';

        // Only clear current chat if preservation is not enabled
        if (!shouldPreserveChat) {
          dispatch(clearCurrentChat());
        }
        onNoActiveChatFound?.(error);
      }
    } catch (error) {
      onNoActiveChatFound?.(error);
    } finally {
      isCheckingRef.current = false;
    }
  }, [
    dispatch,
    getCounsellorChat,
    userData?.isAuthenticated,
    onActiveChatFound,
    onNoActiveChatFound,
    getCurrentRoute,
  ]);

  const handleAppStateChange = useCallback(
    async (nextAppState: AppStateStatus) => {
      // Check if app is coming to foreground
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        userData?.isAuthenticated &&
        userData?.user?.role === UserRole.COUNSELOR
      ) {
        await checkCounselorChat();
      }
      appState.current = nextAppState;
    },
    [checkCounselorChat, userData],
  );

  useEffect(() => {
    if (!shouldSubscribeToAppState) {
      return;
    }
    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [handleAppStateChange, shouldSubscribeToAppState]);

  return {
    checkCounselorChat,
  };
};
