import {useCallback, useEffect, useState} from 'react';
import {Platform} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';

interface UseLiveAudioStreamOptions {
  onAudioData: (base64Wav: string) => void;
  enableLiveAudio: boolean;
}

export const useLiveAudioStream = ({
  onAudioData,
  enableLiveAudio,
}: UseLiveAudioStreamOptions) => {
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!enableLiveAudio) return;
    LiveAudioStream.init({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      audioSource: Platform.OS === 'ios' ? 1 : 7,
      bufferSize: 1024,
      wavFile: 'audio.wav', // required
    });

    LiveAudioStream.on('data', onAudioData);

    return () => {
      LiveAudioStream.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableLiveAudio]);

  const startStreaming = useCallback(async () => {
    LiveAudioStream.start();
    setIsStreaming(true);
  }, []);

  const stopStreaming = useCallback(() => {
    LiveAudioStream.stop();
    setIsStreaming(false);
  }, []);

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
  };
};
