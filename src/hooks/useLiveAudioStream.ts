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

  const initAudioStream = useCallback(() => {
    LiveAudioStream?.init?.({
      sampleRate: MICROPHONE_AUDIO_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      audioSource: isIOS ? 1 : 7,
      bufferSize: 1024,
      wavFile: 'audio.wav',
    });
    LiveAudioStream?.on?.('data', onAudioData);
  }, [onAudioData]);

  const checkPermission = useCallback(
    async (shouldRequestIfNeeded = false) => {
      if (!enableLiveAudio || !MICROPHONE_PERMISSION) return;

      try {
        const status = await check(MICROPHONE_PERMISSION);
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

  // Re-check permissions when app becomes active (user might have granted permission from settings)
  useEffect(() => {
    if (!enableLiveAudio) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        permissionStatus !== RESULTS.GRANTED
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

    return () => {
      LiveAudioStream?.stop?.();
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableLiveAudio, permissionStatus]);

  const startStreaming = () => {
    setTimeout(() => {
      LiveAudioStream?.start?.();
      setIsStreaming(true);
    }, 1000);
  };

  const stopStreaming = useCallback(() => {
    LiveAudioStream?.stop?.();
    setIsStreaming(false);
  }, []);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    permissionStatus,
    isPermissionGranted: permissionStatus === RESULTS.GRANTED,
  };
};
