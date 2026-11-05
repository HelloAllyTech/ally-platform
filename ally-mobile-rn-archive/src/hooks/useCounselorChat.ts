import {useCallback, useEffect, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';

import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {RouteNames} from '@/navigation';
import {useLazyGetCounsellorChatQuery} from '@/services/chatApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat, setCurrentChat} from '@/store/slices/chatSlice';
import {Chat} from '@/types';

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
  const permissions = useAppSelector(state => state.user.permissions);
  const dispatch = useAppDispatch();
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const appState = useRef(AppState.currentState);
  const isCheckingRef = useRef(false);

  const checkCounselorChat = useCallback(async () => {
    // Prevent multiple simultaneous checks
    if (
      !userData?.isAuthenticated ||
      isCheckingRef.current ||
      !permissions.includes(USER_PERMISSIONS.VIEW_COUNSELOR_CHAT)
    )
      return;

    try {
      isCheckingRef.current = true;
      const {data, error} = await getCounsellorChat();

      // If data is a non-empty object (active chat), dispatch and notify
      if (data && !Array.isArray(data)) {
        dispatch(setCurrentChat(data));
        onActiveChatFound?.(data);
      } else {
        const currentRoute = getCurrentRoute?.() as RouteNames;
        const shouldPreserveChat =
          currentRoute === SCREEN_NAMES.BREATHING ||
          currentRoute === SCREEN_NAMES.CALL_SUMMARY ||
          currentRoute === SCREEN_NAMES.LISTENING;

        if (!shouldPreserveChat) {
          dispatch(clearCurrentChat());
        }
        onNoActiveChatFound?.(error);
      }
      return data;
    } catch (error) {
      onNoActiveChatFound?.(error);
      return error;
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
    permissions,
  ]);

  const handleAppStateChange = useCallback(
    async (nextAppState: AppStateStatus) => {
      // Check if app is coming to foreground
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        userData?.isAuthenticated &&
        permissions.includes(USER_PERMISSIONS.VIEW_COUNSELOR_CHAT)
      ) {
        await checkCounselorChat();
      }
      appState.current = nextAppState;
    },
    [checkCounselorChat, userData, permissions],
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
