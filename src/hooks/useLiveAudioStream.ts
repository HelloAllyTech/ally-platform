import {useCallback, useEffect, useRef, useState} from 'react';
import {Platform} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import {PERMISSIONS, request} from 'react-native-permissions';

import {logger} from '@/utils/logger';

interface UseLiveAudioStreamOptions {
  onAudioData: (data: string) => void;
  chatId?: string;
}

export const useLiveAudioStream = ({
  onAudioData,
  chatId,
}: UseLiveAudioStreamOptions) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const dataCountRef = useRef(0);

  const checkPermissions = useCallback(async () => {
    if (Platform.OS === 'ios') {
      return await requestIosPermissions();
    } else {
      return await requestAndroidPermissions();
    }
  }, []);

  const requestIosPermissions = async () => {
    try {
      const result = await request(PERMISSIONS.IOS.MICROPHONE);

      if (result !== 'granted') {
        logger.error('Microphone permission denied');
        return false;
      } else {
        return true;
      }
    } catch (err) {
      return false;
    }
  };

  const requestAndroidPermissions = async () => {
    try {
      const result = await request(PERMISSIONS.ANDROID.RECORD_AUDIO);

      if (result !== 'granted') {
        logger.error('Microphone permission denied');
        return false;
      } else {
        return true;
      }
    } catch (err) {
      return false;
    }
  };

  const handleAudioData = useCallback(
    (data: string) => {
      dataCountRef.current += 1;
      onAudioData(data);
    },
    [onAudioData],
  );

  useEffect(() => {
    const initPermissions = async () => {
      const permissionGranted = await checkPermissions();
      setHasPermission(permissionGranted);
    };

    initPermissions();
  }, [checkPermissions]);

  useEffect(() => {
    const options = {
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      audioSource: Platform.OS === 'ios' ? 1 : 7,
      bufferSize: 2048,
      wavFile: 'audio.wav',
    };

    LiveAudioStream.init(options);
    LiveAudioStream.on('data', handleAudioData);

    return () => {
      LiveAudioStream.stop();
      dataCountRef.current = 0;
    };
  }, [handleAudioData]);

  const startStreaming = useCallback(async () => {
    try {
      if (!hasPermission) {
        logger.info('Microphone permission not granted');
        return;
      }
      logger.info(`startStreaming, chatId: ${chatId}`);
      LiveAudioStream.start();
      setIsStreaming(true);
      dataCountRef.current = 0;
    } catch (error) {
      logger.error(`Error starting stream: ${error}`);
    }
  }, [hasPermission, chatId]);

  const stopStreaming = useCallback(() => {
    LiveAudioStream.stop();
    setIsStreaming(false);
    dataCountRef.current = 0;
  }, []);

  return {
    isStreaming,
    hasPermission,
    startStreaming,
    stopStreaming,
  };
};
