import {t} from 'i18next';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
} from 'react-native-track-player';

import {logger} from '@/utils/logger';

export const PlaybackService = async function () {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
};

export const setupPlayer = async () => {
  try {
    await TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    });
    await TrackPlayer.updateOptions({
      capabilities: [Capability.Play, Capability.Pause, Capability.Stop],
      compactCapabilities: [Capability.Play, Capability.Pause],
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
    });
  } catch (error) {
    logger.error(`${t('BoxBreathingScreen.trackPlayer.error')} ${error}`);
  }
};

export const addTrack = async (audioFile: any) => {
  try {
    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: 'breathing-track',
      url: audioFile,
      title: 'Breathing Exercise',
      artist: 'Meditation Music',
      isLiveStream: false,
    });
  } catch (error) {
    logger.error(
      `${t('BoxBreathingScreen.trackPlayer.errorAddingTrack')} ${error}`,
    );
  }
};
