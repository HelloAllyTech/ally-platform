import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, Text, TouchableOpacity} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import {PERMISSIONS, request} from 'react-native-permissions';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {useWebSocket} from '@/hooks/useWebSocket';
import {logger} from '@/utils/logger';

export const LiveRecordingScreen: React.FC = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const dataCountRef = useRef(0);
  const {sendAudioData, isConnected, connect, disconnect} = useWebSocket({});

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
      dataCountRef.current += 1;
      if (isConnected()) {
        sendAudioData(data);
      }
    },
    [sendAudioData, isConnected],
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
      connect();
      LiveAudioStream.start();
      setIsStreaming(true);
      dataCountRef.current = 0;
    } catch (error) {
      logger.error(`Error starting stream: ${error}`);
    }
  }, [hasPermission, connect]);

  const stopStreaming = useCallback(() => {
    LiveAudioStream.stop();
    disconnect();
    setIsStreaming(false);
    dataCountRef.current = 0;
  }, [disconnect]);

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
