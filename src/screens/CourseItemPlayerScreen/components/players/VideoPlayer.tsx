import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Video, {
  OnPlaybackStateChangedData,
  OnProgressData,
} from 'react-native-video';

import {colors} from '@/theme';

export interface VideoPlayerProps {
  url: string;
  onProgressTime: (timeSeconds: number) => void;
  onPauseOrEnd: () => void;
}

/**
 * Thin native video playback wrapper (S3-hosted sources only — see
 * `VideoFallbackCard` for youtube/vimeo/loom). Forwards raw playhead/pause
 * events to the caller, which owns the watch-progress accounting (mirrors
 * ally-web's generic `ProgressVideoPlayer`, which is likewise
 * source-agnostic and leaves accounting to `VideoItemPlayer`).
 */
export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  url,
  onProgressTime,
  onPauseOrEnd,
}) => {
  const handleProgress = (data: OnProgressData) => {
    onProgressTime(data.currentTime);
  };

  const handlePlaybackStateChanged = (data: OnPlaybackStateChangedData) => {
    if (!data.isPlaying) onPauseOrEnd();
  };

  return (
    <View style={styles.container}>
      <Video
        testID="course-video-player"
        source={{uri: url}}
        style={styles.video}
        resizeMode="contain"
        controls
        onProgress={handleProgress}
        onEnd={onPauseOrEnd}
        onPlaybackStateChanged={handlePlaybackStateChanged}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.black,
  },
  video: {
    width: '100%',
    height: '100%',
  },
});
