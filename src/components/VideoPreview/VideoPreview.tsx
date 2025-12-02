import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Video from 'react-native-video';

import {colors} from '@/theme';

export interface VideoPreviewProps {
  videoUrl: string;
  style?: ViewStyle;
  autoPlay?: boolean;
  showPlayIcon?: boolean;
  muted?: boolean;
  onPlayStateChange?: (isPlaying: boolean) => void;
  shouldPause?: boolean;
  testID?: string;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoUrl,
  style,
  autoPlay = false,
  muted = false,
  onPlayStateChange,
  shouldPause = false,
  testID,
}) => {
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (shouldPause && isPlaying) {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    }
  }, [shouldPause, isPlaying, onPlayStateChange]);

  useEffect(() => {
    return () => {
      setIsPlaying(false);
    };
  }, []);

  const handlePlayPress = () => {
    const newPlayState = true;
    setIsPlaying(newPlayState);
    onPlayStateChange?.(newPlayState);
  };

  const handlePausePress = () => {
    const newPlayState = false;
    setIsPlaying(newPlayState);
    setIsLoading(false);
    onPlayStateChange?.(newPlayState);
  };

  const handleVideoReady = () => {
    setIsLoading(false);
  };

  const renderPlayPauseOverlay = () => {
    if (isPlaying) {
      return (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePausePress}
          style={styles.videoPauseOverlay}
          testID={`${testID}-pause-button`}
        />
      );
    } else {
      return (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePlayPress}
          style={styles.videoOverlay}
          testID={`${testID}-play-button`}>
          <View style={styles.playIconContainer}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        </TouchableOpacity>
      );
    }
  };

  return (
    <View style={[styles.videoContainer, style]} testID={testID}>
      <Video
        source={{uri: videoUrl}}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        paused={!isPlaying}
        repeat
        muted={muted}
        controls={false}
        audioOutput="speaker"
        ignoreSilentSwitch="ignore"
        useTextureView
        onReadyForDisplay={handleVideoReady}
      />

      {isLoading ? (
        <View style={styles.videoOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.white} />
        </View>
      ) : (
        renderPlayPauseOverlay()
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  videoContainer: {
    position: 'relative',
    width: '100%',
    height: '180@ms',
    borderRadius: '8@ms',
    overflow: 'hidden',
    backgroundColor: colors.black,
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.smokyBlack,
  },
  videoPauseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  playIconContainer: {
    width: '50@ms',
    height: '50@ms',
    borderRadius: '25@ms',
    backgroundColor: colors.whiteTransparent90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: '20@ms',
    color: colors.black,
    marginLeft: '3@ms',
  },
});
