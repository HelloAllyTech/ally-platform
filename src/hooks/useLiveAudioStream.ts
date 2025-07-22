import {useCallback, useEffect, useState} from 'react';
import {Alert, Platform} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import {
  check,
  openSettings,
  PERMISSIONS,
  request,
  RESULTS,
} from 'react-native-permissions';

import {isIOS, MICROPHONE_AUDIO_SAMPLE_RATE} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {logger} from '@/utils/logger';

import {useAppNavigation} from './useAppNavigation';

interface UseLiveAudioStreamOptions {
  onAudioData: (base64Wav: string) => void;
  enableLiveAudio: boolean;
}

export const useLiveAudioStream = ({
  onAudioData,
  enableLiveAudio,
}: UseLiveAudioStreamOptions) => {
  const {t} = useTranslate();
  const [isStreaming, setIsStreaming] = useState(false);
  const navigation = useAppNavigation();
  const [permissionStatus, setPermissionStatus] =
    useState<(typeof RESULTS)[keyof typeof RESULTS]>('unavailable');

  const micPermission = Platform.select({
    ios: PERMISSIONS.IOS.MICROPHONE,
    android: PERMISSIONS.ANDROID.RECORD_AUDIO,
  });

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

  useEffect(() => {
    if (!enableLiveAudio || !micPermission) return;
    (async () => {
      try {
        const status = await check(micPermission);
        if (status === 'granted') {
          setPermissionStatus('granted');
          initAudioStream();
        } else {
          const result = await request(micPermission);
          setPermissionStatus(result);

          if (result === 'granted') {
            initAudioStream();
          } else {
            Alert.alert(
              t('Common.permissions.microphoneRequired'),
              t('Common.permissions.microphoneMessage'),
              [
                {
                  text: t('Common.cancel'),
                  style: 'cancel',
                  onPress: () => navigation.goBack(),
                },
                {
                  text: t('Common.permissions.openSettings'),
                  onPress: () => openSettings(),
                },
              ],
            );
          }
        }
      } catch (error) {
        logger.error(`Permission check failed: ${error}`);
        setPermissionStatus('denied');
      }
    })();

    return () => {
      LiveAudioStream?.stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableLiveAudio]);

  const startStreaming = useCallback(() => {
    if (permissionStatus !== RESULTS.GRANTED) {
      logger.warn('Cannot start streaming: permission not granted');
      return;
    }
    LiveAudioStream?.start?.();
    setIsStreaming(true);
  }, [permissionStatus]);

  const stopStreaming = useCallback(() => {
    LiveAudioStream?.stop?.();
    setIsStreaming(false);
  }, []);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    permissionStatus,
    isPermissionGranted: permissionStatus === 'granted',
  };
};
