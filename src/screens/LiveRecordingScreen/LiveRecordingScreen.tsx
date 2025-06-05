import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Platform, Text, TouchableOpacity} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import {PERMISSIONS, request} from 'react-native-permissions';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {Toast} from '@/components/Toast/Toast';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {useAppSelector} from '@/store/hooks';
import {SocketEvent} from '@/types/message';
import {logger} from '@/utils/logger';

export const LiveRecordingScreen: React.FC = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    visible: false,
    message: '',
    type: 'error',
  });
  const dataCountRef = useRef(0);
  const {t} = useTranslate();
  const {userData} = useUser();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const chatId = currentChat?.chatId;

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.NUDGE]: (data: any) => {
        logger.info(`NUDGE, data: ${data}`);
        // TODO: Implement socket event callbacks
      },
      [SocketEvent.AUDIO_STREAM]: (data: any) => {
        logger.info(`AUDIO_STREAM, data: ${data}`);
        // TODO: Implement socket event callbacks
      },
    }),
    [],
  );

  const {emitSocketEvent} = useSocketConnection({
    userId: userData?.id,
    eventCallbacks: socketEventCallbacks,
  });

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'error',
  ) => {
    setToast({
      visible: true,
      message,
      type,
    });
  };

  const hideToast = () => {
    setToast(prev => ({...prev, visible: false}));
  };

  const checkPermissions = async () => {
    return await requestIosPermissions();
  };

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
  const handleAudioData = useCallback(
    (data: string) => {
      // logger.info(`handleAudioData, data: ${data}`);
      dataCountRef.current += 1;
      emitSocketEvent(SocketEvent.AUDIO_MESSAGE, {audioData: data, chatId});
    },
    [emitSocketEvent, chatId],
  );

  useEffect(() => {
    const initPermissions = async () => {
      const permissionGranted = await checkPermissions();
      setHasPermission(permissionGranted);
    };

    initPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      emitSocketEvent(SocketEvent.START_AUDIO_CHAT, {chatId});
      LiveAudioStream.start();
      setIsStreaming(true);
      dataCountRef.current = 0;
    } catch (error) {
      logger.error(`Error starting stream: ${error}`);
      showToast(t('LiveRecordingScreen.error.maxRetriesReached'), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  const stopStreaming = () => {
    LiveAudioStream.stop();
    emitSocketEvent(SocketEvent.CHAT_ENDED, {chatId});
    setIsStreaming(false);
    dataCountRef.current = 0;
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Live Audio Streaming</Text>
      {hasPermission === false && (
        <Text style={styles.errorText}>
          Microphone permission is required for streaming
        </Text>
      )}
      <TouchableOpacity
        style={[
          styles.button,
          isStreaming ? styles.stopButton : styles.startButton,
          !hasPermission && styles.disabledButton,
        ]}
        onPress={isStreaming ? stopStreaming : startStreaming}
        disabled={!hasPermission}>
        <Text style={styles.buttonText}>
          {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
        </Text>
      </TouchableOpacity>
      {toast.visible && (
        <Toast message={toast.message} type={toast.type} onHide={hideToast} />
      )}
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {fontSize: '22@ms', marginBottom: '20@ms', fontWeight: '500'},
  button: {
    paddingHorizontal: '20@ms',
    paddingVertical: '14@ms',
    borderRadius: '8@ms',
  },
  startButton: {backgroundColor: '#007AFF'},
  stopButton: {backgroundColor: '#FF3B30'},
  disabledButton: {backgroundColor: '#ccc'},
  buttonText: {color: '#fff', fontSize: '18@ms'},
  errorText: {
    color: '#FF3B30',
    marginBottom: '20@ms',
    textAlign: 'center',
  },
});
