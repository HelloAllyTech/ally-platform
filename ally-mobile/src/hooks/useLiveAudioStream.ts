import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import {check, openSettings, request, RESULTS} from 'react-native-permissions';

import {MICROPHONE_PERMISSION} from '@/constants';
import {isIOS, MICROPHONE_AUDIO_SAMPLE_RATE} from '@/constants/general';
import {useAppNavigation, usePermissionAlert} from '@/hooks';
import {logger} from '@/utils/logger';

interface UseLiveAudioStreamOptions {
  onAudioData: (base64Wav: string) => void;
  enableLiveAudio: boolean;
}

export const useLiveAudioStream = ({
  onAudioData,
  enableLiveAudio,
}: UseLiveAudioStreamOptions) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const navigation = useAppNavigation();
  const [permissionStatus, setPermissionStatus] = useState<
    (typeof RESULTS)[keyof typeof RESULTS]
  >(RESULTS.UNAVAILABLE);
  const [hasRequestedPermission, setHasRequestedPermission] = useState(false);

  const appState = useRef(AppState.currentState);
  const {showSettingsAlert} = usePermissionAlert();
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The recorder can only be initialised once the microphone permission has
   * actually been granted, and that is asynchronous. start() must never run
   * before it: the native module's start() calls recorder.startRecording() on the
   * field that init() creates, with no null check, so starting first is a null
   * dereference in Java — a hard crash, not a failed start. This used to be left
   * to a blind one-second timer, which is simply a bet that the counsellor taps
   * "allow" fast enough. A request to stream while permission is still pending is
   * latched here instead, and honoured the moment init() succeeds.
   */
  const isInitializedRef = useRef(false);
  const wantsStreamingRef = useRef(false);
  const isStreamingRef = useRef(false);
  const permissionStatusRef = useRef(permissionStatus);
  /**
   * One 'data' listener lives for as long as the recorder does (the native module
   * drops any previous listener on each `on` call), so it reads the current
   * callback rather than closing over the one it was registered with.
   */
  const onAudioDataRef = useRef(onAudioData);

  useEffect(() => {
    onAudioDataRef.current = onAudioData;
  }, [onAudioData]);

  useEffect(() => {
    permissionStatusRef.current = permissionStatus;
  }, [permissionStatus]);

  const startRecorder = useCallback(() => {
    if (
      !isInitializedRef.current ||
      !wantsStreamingRef.current ||
      isStreamingRef.current
    ) {
      return;
    }

    try {
      LiveAudioStream?.start?.();
      isStreamingRef.current = true;
      setIsStreaming(true);
    } catch (error) {
      // A microphone held by another app surfaces here, not at init.
      logger.error(`Failed to start audio stream: ${error}`);
    }
  }, []);

  const stopRecorder = useCallback(() => {
    wantsStreamingRef.current = false;
    if (!isStreamingRef.current) return;

    try {
      LiveAudioStream?.stop?.();
    } catch (error) {
      logger.error(`Failed to stop audio stream: ${error}`);
    }
    isStreamingRef.current = false;
  }, []);

  const initAudioStream = useCallback(() => {
    if (!isInitializedRef.current) {
      try {
        LiveAudioStream?.init?.({
          sampleRate: MICROPHONE_AUDIO_SAMPLE_RATE,
          channels: 1,
          bitsPerSample: 16,
          audioSource: isIOS ? 1 : 7,
          bufferSize: 1024,
          wavFile: 'audio.wav',
        });
        LiveAudioStream?.on?.('data', (base64Wav: string) =>
          onAudioDataRef.current?.(base64Wav),
        );
        isInitializedRef.current = true;
      } catch (error) {
        logger.error(`Failed to initialise audio stream: ${error}`);
        return;
      }
    }

    // Honours a startStreaming() that arrived while permission was pending.
    startRecorder();
  }, [startRecorder]);

  const checkPermission = useCallback(
    async (shouldRequestIfNeeded = false) => {
      if (!enableLiveAudio || !MICROPHONE_PERMISSION) return;

      try {
        const status = await check(MICROPHONE_PERMISSION);
        if (!mounted.current) return;

        if (status === RESULTS.GRANTED) {
          setPermissionStatus(RESULTS.GRANTED);
          setHasRequestedPermission(false); // Reset for next time
          initAudioStream();
        } else {
          setPermissionStatus(status);

          // Only request permission if explicitly needed AND we haven't already requested
          if (shouldRequestIfNeeded && !hasRequestedPermission) {
            setHasRequestedPermission(true);
            const result = await request(MICROPHONE_PERMISSION);
            if (!mounted.current) return;
            setPermissionStatus(result);

            if (result === RESULTS.GRANTED) {
              initAudioStream();
            } else {
              showSettingsAlert(
                'simulationPage.allowMicrophone',
                'simulationPage.microphonePrompt',
                {
                  cancelKey: 'common.cancel',
                  settingsKey: 'common.ok',
                  onCancel: () => navigation.goBack(),
                  onOpenSettings: () => openSettings(),
                },
              );
            }
          }
        }
      } catch (error) {
        logger.error(`Permission check failed: ${error}`);
        if (!mounted.current) return;
        setPermissionStatus(RESULTS.DENIED);
      }
    },
    [
      enableLiveAudio,
      hasRequestedPermission,
      initAudioStream,
      navigation,
      showSettingsAlert,
    ],
  );

  // Initial permission check on mount
  useEffect(() => {
    checkPermission(true); // Request permission if needed on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check permissions when app becomes active (user might have granted
  // permission from settings). The recorder is deliberately NOT torn down in this
  // cleanup: it used to be, and because the effect re-ran on every
  // permission-status change, that stopped live recordings mid-session.
  useEffect(() => {
    if (!enableLiveAudio) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        permissionStatusRef.current !== RESULTS.GRANTED
      ) {
        // App has come to foreground and permission was not granted
        // Re-check permission in case user granted it from settings
        checkPermission(false); // Only check, don't request permission again
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    return () => subscription.remove();
  }, [enableLiveAudio, checkPermission]);

  // The recorder outlives every other effect here, so it is released only when
  // the screen itself goes away.
  useEffect(() => stopRecorder, [stopRecorder]);

  const startStreaming = useCallback(() => {
    wantsStreamingRef.current = true;
    startRecorder();
  }, [startRecorder]);

  const stopStreaming = useCallback(() => {
    stopRecorder();
    setIsStreaming(false);
  }, [stopRecorder]);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    permissionStatus,
    isPermissionGranted: permissionStatus === RESULTS.GRANTED,
  };
};
