import React, {useCallback, useMemo, useState} from 'react';
import {Text, TouchableOpacity} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {Toast} from '@/components/Toast/Toast';
import {useLiveAudioStream} from '@/hooks/useLiveAudioStream';
import {useSocketConnection} from '@/hooks/useSocketConnection';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {Timer} from '@/screens/ListeningScreen/components/Timer';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme/colors';
import {SocketEvent} from '@/types/message';
import {logger} from '@/utils/logger';

export const LiveRecordingScreen: React.FC = () => {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    visible: false,
    message: '',
    type: 'error',
  });
  const {t} = useTranslate();
  const {userData} = useUser();
  const currentChat = useAppSelector(state => state.chat.currentChat);
  const chatId = currentChat?.chatId?.toString();

  const socketEventCallbacks = useMemo(
    () => ({
      [SocketEvent.NUDGE]: (data: any) => {
        logger.info(`NUDGE, data: ${data}`);
        // TODO: Implement socket event callbacks
      },
      [SocketEvent.AUDIO_STREAM]: (data: any) => {
        // logger.info(`AUDIO_STREAM, data: ${data}`);
        // TODO: Implement socket event callbacks
      },
      [SocketEvent.MESSAGE_RECEIVED]: (data: any) => {
        const message = data.payload;
        logger.info(`Message received: ${message}`);
        if (message.type === 'TEXT') {
          logger.info(`Message received: ${message}`);
        }
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

  const handleAudioData = useCallback(
    (data: string) => {
      emitSocketEvent(SocketEvent.AUDIO_MESSAGE, {audioData: data, chatId});
    },
    [emitSocketEvent, chatId],
  );

  const {isStreaming, hasPermission, startStreaming, stopStreaming} =
    useLiveAudioStream({
      onAudioData: handleAudioData,
      chatId,
    });

  const handleStartStreaming = useCallback(async () => {
    try {
      emitSocketEvent(SocketEvent.START_AUDIO_CHAT, {chatId});
      await startStreaming();
      setStartTime(Date.now());
    } catch (error) {
      logger.error(`Error starting stream: ${error}`);
      showToast(t('LiveRecordingScreen.error.maxRetriesReached'), 'error');
    }
  }, [chatId, emitSocketEvent, startStreaming, t]);

  const handleStopStreaming = useCallback(() => {
    stopStreaming();
    emitSocketEvent(SocketEvent.CHAT_ENDED, {chatId});
    setStartTime(null);
  }, [chatId, emitSocketEvent, stopStreaming]);

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
        onPress={isStreaming ? handleStopStreaming : handleStartStreaming}
        disabled={!hasPermission}>
        <Text style={styles.buttonText}>
          {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
        </Text>
      </TouchableOpacity>
      {startTime && <Timer customStyle={styles.timer} startTime={startTime} />}
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
  timer: {
    marginTop: '20@ms',
    color: colors.azureBlue,
  },
});
