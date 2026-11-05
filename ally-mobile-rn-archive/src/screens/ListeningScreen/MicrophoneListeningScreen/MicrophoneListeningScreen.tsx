import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {LockIcon} from '@/assets';
import {PrivacyTooltip} from '@/components';
import {env} from '@/config/env';
import {
  useDebounce,
  useHardwareBackPressHandler,
  useListeningScreen,
  useLiveAudioStream,
  useNetworkConnectivity,
  useSocketConnection,
  useTranslate,
  useUser,
} from '@/hooks';
import {useGetNudgeStatusQuery} from '@/services';
import {useAppDispatch} from '@/store/hooks';
import {setCurrentChatId} from '@/store/slices/chatSlice';
import {colors, globalStyles} from '@/theme';
import {
  DisconnectedType,
  MessageType,
  SocketEvent,
  SocketMessage,
} from '@/types';
import {getAppVersion} from '@/utils/version';

import {CallTranscriptItem} from '../../CallSummaryScreen/components/CallTranscriptItem';
import {
  AudioWaveformContainer,
  CallEndConfirmationModal,
  ListeningControls,
  NetworkDisconnected,
  NudgeSection,
  Search,
  Timer,
} from '../components';
import {useListeningCommon} from '../hooks';
import {styles} from '../styles';
import {
  getStartAudioChatPayload,
  NUM_BARS,
  recorderAudioToAmplitudes,
} from '../utils';

export const MicrophoneListeningScreen = () => {
  const {t} = useTranslate();
  const {isOffline} = useNetworkConnectivity();
  const {data: nudgeStatus} = useGetNudgeStatusQuery();
  const {userData} = useUser();
  const dispatch = useAppDispatch();

  const [isFocusModeLocal, setIsFocusModeLocal] = useState(true);
  const [isCallPaused, setIsCallPaused] = useState(true);
  const [isMuteTooltipOpen, setIsMuteTooltipOpen] = useState(true);
  const [isAudioChatEmitted, setIsAudioChatEmitted] = useState(false);
  const [isMicrophoneModeSessionCreated, setIsMicrophoneModeSessionCreated] =
    useState(false);
  const [isPermissionGrantedLocal, setIsPermissionGrantedLocal] =
    useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  const {
    chatData,
    isWebMicrophoneMode,
    isFocusMode: commonFocusMode,
    currentNudge,
    isLoading,
    showCallEndConfirmation,
    isPrivacyTooltipVisible,
    isControlSectionMaximized,
    disconnectedType,
    setShowCallEndConfirmation,
    setIsControlSectionMaximized,
    setDisconnectedType,
    setCurrentNudge,
    setIsLoading,
    handleCallEndRedirection,
    handleGoBack,
    handleEndCall: handleEndCallCommon,
    handleNudgeFeedbackSuccess,
    toggleFocusMode: toggleFocusModeCommon,
    handleLockIconPress,
    handlePrivacyTooltipClose,
    checkCounselorChat,
    canShowFocusModeButton,
    speakerTranscriptions,
    myTranscriptions,
    setMyTranscriptions,
    setSpeakerTranscriptions,
    processTranscription,
    updateLastTranscription,
  } = useListeningCommon({
    isMicrophoneMode: true,
    isPermissionGranted: isPermissionGrantedLocal,
  });

  const {tooltipContentList, tooltipDisplayInsets, startTime} =
    useListeningScreen({
      isMicrophoneMode: true,
      isFocusMode: isFocusModeLocal,
      chatData,
    });

  /**
   * There is only something to end once the session has a chat id, and the
   * disconnected view carries its own actions. In both of the other states the
   * end-session confirmation isn't rendered at all, so asking for confirmation
   * there swallowed the back press and left the counsellor on a screen — usually
   * "Connecting…" — with no way out of the app short of force-quitting it.
   */
  const hasLiveSession = Boolean(chatData?.chatId) && !disconnectedType;

  const handleHardwareBackPress = useCallback(() => {
    if (!hasLiveSession) {
      handleGoBack();
      return true;
    }
    if (!showCallEndConfirmation) {
      setShowCallEndConfirmation(true);
      return true;
    }
    return false;
  }, [
    hasLiveSession,
    handleGoBack,
    showCallEndConfirmation,
    setShowCallEndConfirmation,
  ]);

  useHardwareBackPressHandler(handleHardwareBackPress);

  useEffect(() => {
    setIsFocusModeLocal(commonFocusMode);
  }, [commonFocusMode]);

  const streamingInitialized = useRef(false);
  const chatIdTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const isCallPausedRef = useRef(isCallPaused);
  const isWebMicrophoneModeRef = useRef(isWebMicrophoneMode);
  const chatIdRef = useRef(chatData?.chatId);
  const latestAmplitudesRef = useRef<number[] | null>(
    new Array(NUM_BARS).fill(0),
  );

  useEffect(() => {
    isCallPausedRef.current = isCallPaused;
  }, [isCallPaused]);

  useEffect(() => {
    if (!isCallPaused) {
      setIsMuteTooltipOpen(false);
    }
  }, [isCallPaused]);

  const showMuteTooltip =
    isCallPaused && !isWebMicrophoneMode && isMuteTooltipOpen;

  useEffect(() => {
    isWebMicrophoneModeRef.current = isWebMicrophoneMode;
  }, [isWebMicrophoneMode]);

  useEffect(() => {
    chatIdRef.current = chatData?.chatId;
  }, [chatData?.chatId]);

  useEffect(() => {
    if (isOffline && !isWebMicrophoneMode) {
      setDisconnectedType(DisconnectedType.NETWORK);
    }
  }, [isOffline, isWebMicrophoneMode, setDisconnectedType]);

  useEffect(() => {
    const clearChatIdTimeout = () => {
      if (chatIdTimeoutRef.current) {
        clearTimeout(chatIdTimeoutRef.current);
        chatIdTimeoutRef.current = null;
      }
    };

    if (!chatData?.chatId) {
      chatIdTimeoutRef.current = setTimeout(() => {
        setDisconnectedType(DisconnectedType.MICROPHONE_FAILURE);
      }, 5000);
    } else {
      clearChatIdTimeout();
    }

    return clearChatIdTimeout;
  }, [chatData?.chatId, setDisconnectedType]);

  const userId = userData?.id;

  // Process existing messages from chatData
  useEffect(() => {
    if (chatData?.messages && chatData.messages.length > 0) {
      const existingTranscriptions = [...chatData.messages]
        .reverse()
        .filter(transcription => transcription.type === MessageType.TEXT)
        .map(transcription => ({
          id: transcription.id,
          message: transcription.content,
          senderId: transcription.senderId,
          timestamp: transcription.createdAt,
          isFinal: true,
          isSentenceComplete: true,
        }));
      setMyTranscriptions(
        existingTranscriptions?.filter(payload => payload.senderId === userId),
      );
      setSpeakerTranscriptions(
        existingTranscriptions?.filter(payload => payload.senderId !== userId),
      );
    }
  }, [chatData, userId, setMyTranscriptions, setSpeakerTranscriptions]);

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.SESSION_CREATED]: () => {
        setIsMicrophoneModeSessionCreated(true);
      },
      [SocketEvent.CHAT_ENDED]: () => {
        handleCallEndRedirection();
      },
      [SocketEvent.NUDGE]: (data: SocketMessage) => {
        if (data.payload) {
          setIsLoading(true);
          setTimeout(() => {
            setCurrentNudge({
              id: data.payload!.id,
              content: data.payload!.content,
              chatId: data.payload!.chatId,
              senderId: data.payload!.senderId,
              createdAt: data.payload!.createdAt,
              feedback: data.payload!.feedback,
            });
            setIsLoading(false);
          }, 500);
        }
      },
      /**
       * The event already carries the chat id — the server puts it there when it
       * creates the chat. Use it, then hydrate the rest.
       *
       * This used to only call checkCounselorChat(), throwing the id away and
       * depending entirely on a GET round trip to learn it. Production caught
       * that failing: chat 2580 was created and broadcast at 08:19:36, and the
       * client still reported hasChatId false at 5s AND 15s, so the screen timed
       * out into "Microphone failure" on a session the server had already
       * started. Tapping "Try again" won the race, which is what made it look
       * intermittent.
       */
      [SocketEvent.USER_JOINED]: async (data: SocketMessage) => {
        const joinedChatId = data?.payload?.chatId;
        if (joinedChatId) {
          dispatch(setCurrentChatId(joinedChatId));
        }
        await checkCounselorChat();
      },
      [SocketEvent.MESSAGE_RECEIVED]: data => {
        const message = data.payload;
        if (message.type === MessageType.TEXT) {
          if (message.senderId === userId) {
            processTranscription(setMyTranscriptions, message);
          } else {
            processTranscription(setSpeakerTranscriptions, message);
          }
        }
      },
      [SocketEvent.UTTERANCE_ENDED]: data => {
        if (data?.payload.senderId === userId) {
          updateLastTranscription(setMyTranscriptions);
        } else {
          updateLastTranscription(setSpeakerTranscriptions);
        }
      },
    }),
    [
      dispatch,
      handleCallEndRedirection,
      checkCounselorChat,
      setIsLoading,
      setCurrentNudge,
      userId,
      processTranscription,
      setMyTranscriptions,
      setSpeakerTranscriptions,
      updateLastTranscription,
    ],
  );

  const onDisconnectSocket = useCallback(() => {
    if (!isWebMicrophoneMode) {
      setDisconnectedType(
        isOffline ? DisconnectedType.NETWORK : DisconnectedType.SOCKET,
      );
    }
  }, [isOffline, isWebMicrophoneMode, setDisconnectedType]);

  const onConnectionError = useCallback(() => {
    if (!isWebMicrophoneMode) {
      setDisconnectedType(DisconnectedType.SOCKET);
    }
  }, [isWebMicrophoneMode, setDisconnectedType]);

  const {emitSocketEvent} = useSocketConnection({
    path: env.MICROPHONE_SOCKET_PATH,
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
    onDisconnect: onDisconnectSocket,
    onConnectionError: onConnectionError,
    // A live recording must survive the app being briefly backgrounded (screen
    // lock, a notification, a quick app switch). Tearing the socket down here is
    // what turned those everyday interruptions into "something went wrong" +
    // a lost/partial session. Keep it connected; socket.io buffers across the
    // blip. (A long-locked screen still needs native background-audio — tracked
    // separately.)
    disconnectOnBackground: false,
  });

  const handleAudioData = useCallback(
    (base64Wav: string) => {
      latestAmplitudesRef.current = recorderAudioToAmplitudes(base64Wav);
      // Always emit while a chat is active. socket.io buffers frames when the
      // socket is transiently disconnected and flushes them on reconnect, so
      // audio survives connection blips. Do NOT gate this on a live-connected
      // check: socket.connected dips false during the initial connect window
      // and transport upgrades, and gating there silently drops audio, leaving
      // the backend with an empty transcript and the summary stuck "processing".
      if (
        !isCallPausedRef.current &&
        !isWebMicrophoneMode &&
        !isWebMicrophoneModeRef.current &&
        chatIdRef.current
      ) {
        emitSocketEvent(SocketEvent.AUDIO_MESSAGE, {
          audioData: base64Wav,
          chatId: chatIdRef.current,
        });
      }
    },
    [emitSocketEvent, isWebMicrophoneMode],
  );

  // Live audio stream
  const {startStreaming, stopStreaming, isPermissionGranted, permissionStatus} =
    useLiveAudioStream({
      onAudioData: handleAudioData,
      enableLiveAudio: !isWebMicrophoneMode,
    });

  useEffect(() => {
    setIsPermissionGrantedLocal(isPermissionGranted);
  }, [isPermissionGranted]);

  const isAudioSessionReady = useMemo(
    () =>
      isPermissionGranted &&
      isMicrophoneModeSessionCreated &&
      !isWebMicrophoneMode,
    [isPermissionGranted, isMicrophoneModeSessionCreated, isWebMicrophoneMode],
  );

  useEffect(() => {
    if (!isWebMicrophoneMode && !streamingInitialized.current) {
      streamingInitialized.current = true;
      startStreaming();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAudioSessionReady && !isAudioChatEmitted) {
      setTimeout(() => {
        emitSocketEvent(
          SocketEvent.START_AUDIO_CHAT,
          getStartAudioChatPayload(),
        );
        setIsAudioChatEmitted(true);
      });
    }
  }, [isAudioSessionReady, emitSocketEvent, isAudioChatEmitted]);

  /**
   * Why a recording never starts is currently invisible.
   *
   * Production shows counsellors connecting to /microphone-chat, the server
   * emitting SESSION_CREATED, and START_AUDIO_CHAT then never arriving — the
   * screen sits on "Connecting…". Server logs cannot say which of the three
   * conditions in `isAudioSessionReady` is false, and neither can we, because
   * nothing on this screen reports its state anywhere.
   *
   * So when the session has not started by the time the failure view is due,
   * emit the gate values over the socket we already hold. The server logs one
   * line and does nothing with it, which puts the answer next to that socket's
   * own connect line in CloudWatch, keyed by the same client id. Carries no
   * transcript, no chat content, no PII — booleans, a permission status string
   * and the app version, which is the other thing we could not determine.
   *
   * Delete this once the cause is known.
   */
  const diagnosticSentRef = useRef<Record<string, boolean>>({});
  const gatesRef = useRef({
    isPermissionGranted,
    permissionStatus,
    isMicrophoneModeSessionCreated,
    isWebMicrophoneMode,
    isAudioChatEmitted,
    hasChatId: Boolean(chatData?.chatId),
    isOffline,
  });
  gatesRef.current = {
    isPermissionGranted,
    permissionStatus,
    isMicrophoneModeSessionCreated,
    isWebMicrophoneMode,
    isAudioChatEmitted,
    hasChatId: Boolean(chatData?.chatId),
    isOffline,
  };

  useEffect(() => {
    const send = (afterMs: number) => {
      if (diagnosticSentRef.current[afterMs]) return;
      // The ONLY suppression: a session that actually started needs no
      // explanation. Deliberately not gated on `hasChatId` or on
      // `isWebMicrophoneMode` any more.
      //
      // It used to skip on both, and that blinded us exactly where it mattered.
      // Production showed 1.23.21+ clients opening the recording screen,
      // receiving SESSION_CREATED, and then emitting neither START_AUDIO_CHAT
      // nor a diagnostic — and the only client states that explain the silence
      // are a true `isWebMicrophoneMode` or a stale `hasChatId`, i.e. precisely
      // the two flags the old gate refused to report on. Instrumentation must
      // not go quiet on the conditions it exists to reveal.
      if (gatesRef.current.isAudioChatEmitted && gatesRef.current.hasChatId) {
        return;
      }
      diagnosticSentRef.current[afterMs] = true;

      emitSocketEvent(SocketEvent.SCRIBE_START_DIAGNOSTIC, {
        afterMs,
        appVersion: getAppVersion(),
        ...gatesRef.current,
      });
    };

    // 5s matches when the microphone-failure view appears; 15s catches the
    // counsellors who sit and wait rather than backing out.
    const first = setTimeout(() => send(5000), 5000);
    const second = setTimeout(() => send(15000), 15000);

    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [emitSocketEvent]);

  const handleEndCall = useCallback(() => {
    handleEndCallCommon(() => {
      stopStreaming();
      streamingInitialized.current = false;
    });
  }, [handleEndCallCommon, stopStreaming]);

  const handlePlayPauseCallPress = useDebounce(
    () => {
      setIsCallPaused(prev => !prev);
    },
    {delay: 500},
  );

  const handleTryAgain = useCallback(() => {
    setDisconnectedType(null);
    handleGoBack();
  }, [handleGoBack, setDisconnectedType]);

  const tooltipContent = (
    <View style={styles.tooltipContent}>
      {tooltipContentList.map((item, index) => (
        <Text key={index} style={styles.tooltipText}>
          • {item}
        </Text>
      ))}
    </View>
  );

  const renderTakingNotes = () => {
    return (
      <View style={styles.takingNotesContainer}>
        <PrivacyTooltip
          tooltipContent={tooltipContent}
          isVisible={isPrivacyTooltipVisible}
          onClose={handlePrivacyTooltipClose}
          placement={isFocusModeLocal ? 'top' : 'bottom'}
          displayInsets={tooltipDisplayInsets}>
          <TouchableOpacity
            onPress={handleLockIconPress}
            disabled={!isFocusModeLocal}
            activeOpacity={0.8}>
            <LockIcon width={16} height={16} color={colors.lightGrayD9} />
          </TouchableOpacity>
        </PrivacyTooltip>
        <Text style={styles.takingNotesText}>
          {t('listeningScreen.takingNotes')}
        </Text>
      </View>
    );
  };

  if (disconnectedType) {
    return (
      <View style={styles.container}>
        <NetworkDisconnected
          onRetry={handleTryAgain}
          onGoBack={handleGoBack}
          disconnectedType={disconnectedType}
        />
      </View>
    );
  }

  if (!chatData?.chatId) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.white} />
        <Text style={styles.loadingText}>
          {t('listeningScreen.connecting')}
        </Text>
        {/*
          Connecting can stall behind a slow network for the five seconds it takes
          the microphone-failure view to appear. Leaving the screen with no visible
          exit for that long reads as a frozen app.
        */}
        <TouchableOpacity
          onPress={handleGoBack}
          style={styles.connectingCancel}
          testID="connecting-cancel">
          <Text style={styles.connectingCancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const getElapsedSeconds = (timestamp: string) => {
    if (!chatData?.startedAt) return '00:00';
    const start = new Date(chatData.startedAt).getTime();
    const current = new Date(timestamp).getTime();
    const diffInSeconds = Math.floor((current - start) / 1000);
    const minutes = Math.floor(diffInSeconds / 60);
    const seconds = diffInSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  };

  const allTranscriptions = [
    ...myTranscriptions,
    ...speakerTranscriptions,
  ].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const renderFocusMode = () => {
    return (
      <View style={styles.focusModeLayout}>
        {renderTakingNotes()}
        <Timer startTime={startTime} />
        <View style={styles.focusModeWaveformWrapper}>
          <AudioWaveformContainer
            latestAmplitudesRef={latestAmplitudesRef}
            isCallPaused={isCallPaused}
            isFocusMode
          />
        </View>
        {!isWebMicrophoneMode && (
          <Text style={styles.microphoneModeNote}>
            {t('listeningScreen.microphoneModeNote')}
          </Text>
        )}
      </View>
    );
  };

  const renderNonFocusMode = () => {
    return (
      <View style={styles.nonFocusModeLayout}>
        <View style={globalStyles.rowCenter}>
          <View style={styles.nonFocusLabelBlock}>
            {renderTakingNotes()}
            <Timer startTime={startTime} />
          </View>
          <View style={styles.nonFocusModeWaveformWrapper}>
            <AudioWaveformContainer
              latestAmplitudesRef={latestAmplitudesRef}
              isCallPaused={isCallPaused}
              isFocusMode={false}
            />
          </View>
        </View>
        {!!nudgeStatus && currentNudge && (
          <NudgeSection
            nudge={currentNudge}
            isLoading={isLoading}
            onFeedbackSuccess={handleNudgeFeedbackSuccess}
          />
        )}
        <Search />
        <ScrollView
          style={styles.transcriptionScrollView}
          contentContainerStyle={styles.transcriptionContentContainer}
          ref={scrollViewRef}
          onContentSizeChange={() =>
            scrollViewRef.current?.scrollToEnd({animated: true})
          }>
          {allTranscriptions.map((transcription, index) => (
            <CallTranscriptItem
              key={index}
              time={getElapsedSeconds(transcription.timestamp)}
              message={transcription.message}
              counselor={transcription.senderId === userId}
              speakerLabel={
                transcription.senderId === userId
                  ? t('transcription.youLabel')
                  : t('transcription.clientLabel')
              }
            />
          ))}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {showCallEndConfirmation && (
        <CallEndConfirmationModal
          visible={showCallEndConfirmation}
          onClose={() => setShowCallEndConfirmation(false)}
          onConfirm={handleEndCall}
          isMicrophoneMode
        />
      )}
      <StatusBar
        backgroundColor="transparent"
        translucent
        barStyle="light-content"
      />
      {isFocusModeLocal ? renderFocusMode() : renderNonFocusMode()}
      <ListeningControls
        isMaximized={isControlSectionMaximized}
        onToggleMaximized={() => setIsControlSectionMaximized(prev => !prev)}
        onFocusModeButtonPress={toggleFocusModeCommon}
        isFocusMode={isFocusModeLocal}
        onCallEndPress={() => setShowCallEndConfirmation(true)}
        isCallPaused={isCallPaused}
        onPauseResumePress={handlePlayPauseCallPress}
        showPauseResumeButton
        showEndSessionButton
        isPauseResumeDisabled={isWebMicrophoneMode}
        showFocusModeButton={canShowFocusModeButton}
        showMuteTooltip={showMuteTooltip}
        onDismissMuteTooltip={() => setIsMuteTooltipOpen(false)}
      />
    </View>
  );
};
