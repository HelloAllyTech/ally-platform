import {useCallback, useEffect, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import {useSelector} from 'react-redux';

import {useLazyGetCounsellorChatQuery} from '@/services/chatApi';
import {useAppDispatch} from '@/store/hooks';
import {setCurrentChat} from '@/store/slices/chatSlice';
import {RootState} from '@/store/store';
import {Chat} from '@/types/message';

interface UseCounselorChatProps {
  onActiveChatFound?: (data: Chat) => void;
  onNoActiveChatFound?: (error: unknown) => void;
  shouldSubscribeToAppState?: boolean;
}

export const useCounselorChat = ({
  onActiveChatFound,
  onNoActiveChatFound,
  shouldSubscribeToAppState = false,
}: UseCounselorChatProps = {}) => {
  const isAuthenticated = useSelector(
    (state: RootState) => state.user.isAuthenticated,
  );
  const dispatch = useAppDispatch();
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const appState = useRef(AppState.currentState);
  const isCheckingRef = useRef(false);

  const checkCounselorChat = useCallback(async () => {
    // Prevent multiple simultaneous checks
    if (!isAuthenticated || isCheckingRef.current) return;

    try {
      isCheckingRef.current = true;
      const {data, error} = await getCounsellorChat();

      // If data is a non-empty object (active chat), dispatch and notify
      if (data && !Array.isArray(data)) {
        dispatch(setCurrentChat(data));
        onActiveChatFound?.(data);
      } else {
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
    isAuthenticated,
    onActiveChatFound,
    onNoActiveChatFound,
  ]);

  const handleAppStateChange = useCallback(
    async (nextAppState: AppStateStatus) => {
      // Check if app is coming to foreground
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        isAuthenticated
      ) {
        await checkCounselorChat();
      }
      appState.current = nextAppState;
    },
    [checkCounselorChat, isAuthenticated],
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
