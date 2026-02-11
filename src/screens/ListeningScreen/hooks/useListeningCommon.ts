import {useCallback, useEffect, useMemo, useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import {AppState} from 'react-native';

import {AllyPlatforms, SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {useAppNavigation, useCounselorChat} from '@/hooks';
import {
  useEndCallMutation,
  useLazyGetCounsellorChatQuery,
} from '@/services/chatApi';
import {useLazyGetSummaryFieldsQuery} from '@/services/settingsApi';
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {ChatProvider, DisconnectedType, FeedbackResponse, Nudge} from '@/types';
import {Maybe} from '@/utils';

interface UseListeningCommonParams {
  isMicrophoneMode: boolean;
  isPermissionGranted?: boolean;
}

export const useListeningCommon = ({
  isMicrophoneMode,
  isPermissionGranted = false,
}: UseListeningCommonParams) => {
  const navigation = useAppNavigation();
  const dispatch = useAppDispatch();
  const isFocused = useIsFocused();
  const {checkCounselorChat} = useCounselorChat();
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const [endCall, {isSuccess: isEndCallSuccess, isError: isEndCallError}] =
    useEndCallMutation();
  const [getSummaryFields] = useLazyGetSummaryFieldsQuery();

  const chatData = useAppSelector(state => state.chat.currentChat);
  const permissions = useAppSelector(state => state.user.permissions);

  // Compute isWebMicrophoneMode from chatData
  const isWebMicrophoneMode = useMemo(
    () =>
      chatData?.provider === ChatProvider.MICROPHONE &&
      chatData?.platform === AllyPlatforms.WEB,
    [chatData?.provider, chatData?.platform],
  );

  // UI State
  const [isFocusMode, setIsFocusMode] = useState(true);
  const [currentNudge, setCurrentNudge] = useState<Maybe<Nudge>>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showCallEndConfirmation, setShowCallEndConfirmation] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isPrivacyTooltipVisible, setIsPrivacyTooltipVisible] = useState(false);
  const [isControlSectionMaximized, setIsControlSectionMaximized] =
    useState(true);
  const [disconnectedType, setDisconnectedType] =
    useState<DisconnectedType | null>(null);

  // Navigation handlers
  const handleCallEndRedirection = useCallback(() => {
    if (isFocused) {
      getSummaryFields();
      navigation.replace(SCREEN_NAMES.BREATHING);
    }
  }, [navigation, isFocused, getSummaryFields]);

  const handleGoBack = useCallback(() => {
    dispatch(clearCurrentChat());
    navigation.goBack();
  }, [navigation, dispatch]);

  // Call end logic
  const handleEndCall = useCallback(
    (stopStreamingFn?: () => void) => {
      const {chatId} = chatData || {};
      if (!chatId) return;

      if (isMicrophoneMode && !isWebMicrophoneMode && stopStreamingFn) {
        stopStreamingFn();
      }

      endCall({chatId});
    },
    [chatData, isMicrophoneMode, isWebMicrophoneMode, endCall],
  );

  // Handle end call success/error
  useEffect(() => {
    if (isEndCallSuccess) {
      handleCallEndRedirection();
    }
    if (isEndCallError) {
      handleCallEndRedirection();
    }
  }, [isEndCallSuccess, isEndCallError, handleCallEndRedirection]);

  // Nudge handlers
  const handleNudgeFeedbackSuccess = useCallback(
    (feedback: FeedbackResponse) => {
      setCurrentNudge(prev => {
        if (prev) {
          return {
            ...prev,
            feedback: feedback,
          };
        }
        return prev;
      });
    },
    [],
  );

  // Focus mode toggle
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(prev => !prev);
  }, []);

  // Tooltip handlers
  const handleLockIconPress = useCallback(() => {
    setIsPrivacyTooltipVisible(prev => !prev);
  }, []);

  const handlePrivacyTooltipClose = useCallback(() => {
    setIsPrivacyTooltipVisible(false);
  }, []);

  // AppState listener for checking active chats
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        setTimeout(() => {
          if (
            isMicrophoneMode &&
            !isWebMicrophoneMode &&
            !isPermissionGranted &&
            !permissions.includes(USER_PERMISSIONS.VIEW_COUNSELOR_CHAT)
          ) {
            return;
          }

          getCounsellorChat().then(res => {
            if (
              !res.data ||
              (Array.isArray(res.data) && res.data.length === 0)
            ) {
              handleCallEndRedirection();
            }
          });
        }, 500);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [
    isMicrophoneMode,
    isWebMicrophoneMode,
    isPermissionGranted,
    permissions,
    getCounsellorChat,
    handleCallEndRedirection,
  ]);

  // Navigation options
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !isMicrophoneMode,
    });
  }, [isMicrophoneMode, navigation]);

  // Keep screen awake during listening
  useEffect(() => {
    try {
      activateKeepAwake();
    } catch (error) {
      console.warn('Failed to activate keep awake:', error);
    }

    return () => {
      try {
        deactivateKeepAwake();
      } catch (error) {
        console.warn('Failed to deactivate keep awake:', error);
      }
    };
  }, []);

  const canShowFocusModeButton = useMemo(
    () => permissions?.includes(USER_PERMISSIONS.VIEW_REFERENCE_DOCUMENT),
    [permissions],
  );

  return {
    // State
    chatData,
    permissions,
    isWebMicrophoneMode,
    isFocusMode,
    currentNudge,
    isLoading,
    showCallEndConfirmation,
    isBannerDismissed,
    isPrivacyTooltipVisible,
    isControlSectionMaximized,
    disconnectedType,

    // Setters
    setCurrentNudge,
    setIsLoading,
    setShowCallEndConfirmation,
    setIsBannerDismissed,
    setIsControlSectionMaximized,
    setDisconnectedType,

    // Handlers
    handleCallEndRedirection,
    handleGoBack,
    handleEndCall,
    handleNudgeFeedbackSuccess,
    toggleFocusMode,
    handleLockIconPress,
    handlePrivacyTooltipClose,
    checkCounselorChat,

    // Computed
    canShowFocusModeButton,
  };
};
