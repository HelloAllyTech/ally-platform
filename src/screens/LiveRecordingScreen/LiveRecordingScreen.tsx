import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

const audioRecorderPlayer = new AudioRecorderPlayer();

export const LiveRecordingScreen: React.FC = () => {
  const {t} = useTranslate();
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordTime, setRecordTime] = useState('00:00:00');
  const [recordedFilePath, setRecordedFilePath] = useState('');

  const onStartRecord = async () => {
    try {
      await audioRecorderPlayer.setSubscriptionDuration(0.1);

      const result = await audioRecorderPlayer.startRecorder();

      audioRecorderPlayer.addRecordBackListener(e => {
        setRecordTime(
          audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
        );
      });

      setIsRecording(true);
      setRecordedFilePath(result);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const onStopRecord = async () => {
    try {
      const result = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();

      setIsRecording(false);
      setRecordTime('00:00:00');
      setRecordedFilePath(result);
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  };

  const onPlayRecord = async () => {
    if (!recordedFilePath) return;

    try {
      await audioRecorderPlayer.startPlayer(recordedFilePath);
      setIsPlaying(true);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };

  const onStopPlay = async () => {
    await audioRecorderPlayer.stopPlayer();
    setIsPlaying(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.headerTitle}>
          {t('liveRecording.header.title')}
        </Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.timerText}>{recordTime}</Text>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.startButton,
              isRecording && styles.buttonDisabled,
            ]}
            onPress={onStartRecord}
            disabled={isRecording}>
            <Text style={styles.buttonText}>Start Recording</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.button,
              styles.stopButton,
              !isRecording && styles.buttonDisabled,
            ]}
            onPress={onStopRecord}
            disabled={!isRecording}>
            <Text style={styles.buttonText}>Stop Recording</Text>
          </TouchableOpacity>
        </View>
        {recordedFilePath && (
          <View style={styles.playbackContainer}>
            <TouchableOpacity
              style={[
                styles.button,
                styles.playButton,
                isPlaying && styles.buttonDisabled,
              ]}
              onPress={isPlaying ? onStopPlay : onPlayRecord}
              disabled={isRecording}>
              <Text style={styles.buttonText}>
                {isPlaying ? 'Stop Playing' : 'Play Recording'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '4@ms',
    paddingHorizontal: '20@ms',
    paddingBottom: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    color: colors.darkSlate,
    textAlign: 'left',
    fontWeight: '400',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20@s',
  },
  timerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '24@s',
    color: colors.darkSlate,
    marginBottom: '20@s',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: '20@s',
  },
  playbackContainer: {
    width: '100%',
    alignItems: 'center',
  },
  button: {
    paddingHorizontal: '20@s',
    paddingVertical: '12@s',
    borderRadius: '8@s',
    minWidth: '140@s',
  },
  startButton: {
    backgroundColor: '#007AFF',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
  },
  playButton: {
    backgroundColor: '#34C759',
  },
  buttonDisabled: {
    backgroundColor: colors.lightGray5,
  },
  buttonText: {
    color: colors.white,
    fontSize: '16@s',
    textAlign: 'center',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
});
