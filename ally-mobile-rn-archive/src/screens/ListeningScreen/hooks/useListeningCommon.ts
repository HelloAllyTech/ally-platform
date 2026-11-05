import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
import {useAppDispatch, useAppSelector} from '@/store/hooks';
import {clearCurrentChat} from '@/store/slices/chatSlice';
import {
  ChatProvider,
  DisconnectedType,
  FeedbackResponse,
  Nudge,
  Transcription,
} from '@/types';
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
  /**
   * `getCurrentRoute` matters here. Without it, `useCounselorChat` treats an
   * empty response as "no chat anywhere" and dispatches clearCurrentChat — so a
   * refetch that lands a moment before the chat is visible wipes the id the
   * USER_JOINED event just gave us, and the screen falls back to "Connecting…"
   * and then microphone failure. This hook only ever runs on the listening
   * screen, which is one of the routes that preserves the chat.
   */
  const {checkCounselorChat} = useCounselorChat({
    getCurrentRoute: () => SCREEN_NAMES.LISTENING,
  });
  const [getCounsellorChat] = useLazyGetCounsellorChatQuery();
  const [endCall, {isSuccess: isEndCallSuccess, isError: isEndCallError}] =
    useEndCallMutation();

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
  const [speakerTranscriptions, setSpeakerTranscriptions] = useState<
    Transcription[]
  >([]);
  const [myTranscriptions, setMyTranscriptions] = useState<Transcription[]>([]);

  // Transcription processing logic
  const updateLastTranscription = (
    setCorrespondingTranscription: Dispatch<SetStateAction<Transcription[]>>,
  ) => {
    setCorrespondingTranscription(previousTranscriptions => {
      const updatedList = [...previousTranscriptions];
      if (previousTranscriptions.length > 0) {
        updatedList[previousTranscriptions.length - 1] = {
          ...previousTranscriptions[previousTranscriptions.length - 1],
          isFinal: true,
          isSentenceComplete: true,
        };
      }
      return updatedList;
    });
  };

  const processTranscription = (
    setCorrespondingTranscription: Dispatch<SetStateAction<Transcription[]>>,
    payload: {
      id: number;
      content: string;
      senderId: number;
      createdAt: string;
      isFinal: boolean;
      isSentenceComplete: boolean;
    },
  ) => {
    setCorrespondingTranscription(previousTranscriptions => {
      const lastTranscription =
        previousTranscriptions[previousTranscriptions.length - 1];
      if (!lastTranscription) {
        return [
          ...previousTranscriptions,
          {
            id: payload.id,
            message: payload.content,
            senderId: payload.senderId,
            timestamp: payload.createdAt,
            isFinal: payload.isFinal,
            isSentenceComplete: payload.isSentenceComplete,
          },
        ];
      }
      if (!lastTranscription.isFinal) {
        // replace the last transcription with the new one
        const updatedTranscriptions = [...previousTranscriptions];
        updatedTranscriptions[previousTranscriptions.length - 1] = {
          ...lastTranscription,
          message: payload.content,
          isSentenceComplete: payload.isSentenceComplete,
          isFinal: payload.isFinal,
        };
        return updatedTranscriptions;
      }

      if (
        !lastTranscription.isSentenceComplete &&
        lastTranscription.isFinal &&
        payload.isFinal
      ) {
        // concat the last transcription with the new one
        const updatedTranscriptions = [...previousTranscriptions];
        updatedTranscriptions[previousTranscriptions.length - 1] = {
          ...lastTranscription,
          message: `${lastTranscription.message} ${payload.content}`,
          isSentenceComplete: payload.isSentenceComplete,
          isFinal: payload.isFinal,
        };
        return updatedTranscriptions;
      }
      return [
        ...previousTranscriptions,
        {
          id: payload.id,
          message: payload.content,
          senderId: payload.senderId,
          timestamp: payload.createdAt,
          isFinal: payload.isFinal,
          isSentenceComplete: payload.isSentenceComplete,
        },
      ];
    });
  };

  // Navigation handlers
  const handleCallEndRedirection = useCallback(() => {
    if (isFocused) {
      navigation.replace(SCREEN_NAMES.BREATHING);
    }
  }, [navigation, isFocused]);

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
    speakerTranscriptions,
    myTranscriptions,

    // Setters
    setCurrentNudge,
    setIsLoading,
    setShowCallEndConfirmation,
    setIsBannerDismissed,
    setIsControlSectionMaximized,
    setDisconnectedType,
    setSpeakerTranscriptions,
    setMyTranscriptions,

    // Handlers
    handleCallEndRedirection,
    handleGoBack,
    handleEndCall,
    handleNudgeFeedbackSuccess,
    toggleFocusMode,
    handleLockIconPress,
    handlePrivacyTooltipClose,
    checkCounselorChat,
    processTranscription,
    updateLastTranscription,

    // Computed
    canShowFocusModeButton,
  };
};
