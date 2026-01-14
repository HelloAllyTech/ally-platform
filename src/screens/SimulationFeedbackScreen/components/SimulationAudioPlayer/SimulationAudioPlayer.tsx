import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Video, {OnLoadData, OnProgressData, VideoRef} from 'react-native-video';

import {
  Forward10Icon,
  PausePlayerIcon,
  PlayWhiteIcon,
  Replay10Icon,
} from '@/assets';
import {colors, fontFamily} from '@/theme';
import {formatTimeToMMSS} from '@/utils';

interface SimulationAudioPlayerProps {
  audioUrl: string;
  onProgress: (currentTime: number) => void;
  onSeek?: (time: number) => void;
  externalSeekTime?: number | null; // Allow external control to seek
}

export const SimulationAudioPlayer: React.FC<SimulationAudioPlayerProps> = ({
  audioUrl,
  onProgress,
  onSeek,
  externalSeekTime,
}) => {
  const videoRef = useRef<VideoRef>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [progressBarWidth, setProgressBarWidth] = useState(0);

  // Handle external seek requests (e.g. from transcript click)
  useEffect(() => {
    if (externalSeekTime !== undefined && externalSeekTime !== null) {
      handleSeek(externalSeekTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSeekTime]);

  const handleLoad = (data: OnLoadData) => {
    setDuration(data.duration);
    setIsLoading(false);
  };

  const handleProgress = (data: OnProgressData) => {
    if (!isLoading) {
      setCurrentTime(data.currentTime);
      onProgress(data.currentTime);
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (time: number) => {
    const newTime = Math.max(0, Math.min(time, duration || time));
    videoRef.current?.seek(newTime);
    setCurrentTime(newTime);
    onProgress(newTime);
    if (onSeek) {
      onSeek(newTime);
    }
  };

  const handleRewind = () => {
    handleSeek(currentTime - 10);
  };

  const handleForward = () => {
    handleSeek(currentTime + 10);
  };

  const handleProgressBarPress = (e: any) => {
    if (progressBarWidth > 0) {
      const x = e.nativeEvent.locationX;
      const progress = x / progressBarWidth;
      const time = progress * duration;
      handleSeek(time);
    }
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    setProgressBarWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{uri: audioUrl}}
        paused={!isPlaying}
        onLoad={handleLoad}
        onProgress={handleProgress}
        onEnd={() => setIsPlaying(false)}
        onLoadStart={() => setIsLoading(true)}
        playInBackground={false}
        playWhenInactive={false}
        ignoreSilentSwitch="ignore"
      />

      {/* Left: Controls Group */}
      <View style={styles.controlsGroup}>
        <TouchableOpacity
          onPress={handleRewind}
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
          style={styles.seekButton}>
          <Replay10Icon width={24} height={24} color={colors.ds.neutral[400]} />
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePlayPause} style={styles.playButton}>
          {isLoading ? (
            <ActivityIndicator color={colors.ds.theme.primary} size="small" />
          ) : isPlaying ? (
            <PausePlayerIcon
              width={16}
              height={16}
              color={colors.ds.theme.primary}
            />
          ) : (
            <PlayWhiteIcon
              width={16}
              height={16}
              color={colors.ds.theme.primary}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleForward}
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
          style={styles.seekButton}>
          <Forward10Icon
            width={24}
            height={24}
            color={colors.ds.neutral[400]}
          />
        </TouchableOpacity>
      </View>

      {/* Right: Progress Group */}
      <View style={styles.progressGroup}>
        <Text style={styles.timeText}>
          {formatTimeToMMSS(currentTime * 1000)}
        </Text>
        <Pressable
          style={styles.progressBarContainer}
          onPress={handleProgressBarPress}
          onLayout={handleLayout}>
          <View style={styles.progressBarTrack} />
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
              },
            ]}
          />
        </Pressable>
        <Text style={styles.timeText}>{formatTimeToMMSS(duration * 1000)}</Text>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: colors.white,
    paddingVertical: '12@ms',
    paddingHorizontal: '16@ms',
    borderRadius: '8@ms',
    borderWidth: 1,
    borderColor: colors.ds.grey[200],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16@ms',
    marginHorizontal: '25@ms',
    paddingRight: '12@ms',
  },
  controlsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  seekButton: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    backgroundColor: colors.ds.blue[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: '12@ms',
    gap: '6@ms',
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.ds.typography.mediumEmphasis,
    minWidth: '35@ms',
  },
  progressBarContainer: {
    flex: 1,
    height: '20@ms',
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: '6@ms',
    backgroundColor: colors.ds.grey[200],
    borderRadius: '3@ms',
    width: '100%',
  },
  progressBarFill: {
    height: '6@ms',
    backgroundColor: colors.ds.theme.primary,
    borderRadius: '3@ms',
    position: 'absolute',
    left: 0,
  },
});
