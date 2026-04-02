import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {
  AudioContext,
  AudioManager,
  decodeAudioData,
  type AudioBuffer,
} from 'react-native-audio-api';
import {ScaledSheet} from 'react-native-size-matters';

import {PausePlayerIcon, PlayWhiteIcon} from '@/assets';
import {colors, fontFamily} from '@/theme';
import {formatTimeToMMSS} from '@/utils';
import {logger} from '@/utils/logger';

const REMOTE_AUDIO_FETCH_INIT: RequestInit = {
  headers: {
    'User-Agent': 'AllyMobile/1.0 (React Native; simulation feedback)',
    Accept: 'application/ogg,audio/ogg,audio/*,*/*',
  },
};

export type ExternalSeekRequest = {key: number; seconds: number};

interface SimulationAudioPlayerProps {
  audioUrl: string;
  onProgress: (currentTime: number) => void;
  onSeek?: (time: number) => void;
  externalSeek?: ExternalSeekRequest | null;
  containerStyle?: StyleProp<ViewStyle>;
  onPlaybackLoadError?: () => void;
}

export const SimulationAudioPlayer: React.FC<SimulationAudioPlayerProps> = ({
  audioUrl,
  onProgress,
  onSeek,
  externalSeek,
  containerStyle,
  onPlaybackLoadError,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [progressBarWidth, setProgressBarWidth] = useState(0);
  const [decodeError, setDecodeError] = useState(false);
  const [decodedVersion, setDecodedVersion] = useState(0);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<ReturnType<
    AudioContext['createBufferSource']
  > | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const offsetAtPlayStartRef = useRef(0);
  const pausePositionRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const onProgressRef = useRef(onProgress);
  const onSeekRef = useRef(onSeek);
  const onPlaybackLoadErrorRef = useRef(onPlaybackLoadError);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);
  useEffect(() => {
    onPlaybackLoadErrorRef.current = onPlaybackLoadError;
  }, [onPlaybackLoadError]);

  const stopSource = useCallback(() => {
    const src = sourceRef.current;
    if (src) {
      src.onEnded = null;
      try {
        src.stop(0);
      } catch {
        // already stopped
      }
      sourceRef.current = null;
    }
  }, []);

  // Fetch + decode remote OGG via Web Audio API
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    decodedBufferRef.current = null;
    pausePositionRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setDecodeError(false);
    setIsLoading(true);

    (async () => {
      try {
        const response = await fetch(audioUrl, REMOTE_AUDIO_FETCH_INIT);
        if (!response.ok) {
          throw new Error(
            `Audio fetch failed: HTTP ${response.status} ${response.statusText}`,
          );
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Audio fetch returned an empty body');
        }
        const preferredRate = AudioManager.getDevicePreferredSampleRate();
        const buffer = await decodeAudioData(arrayBuffer, preferredRate);
        if (
          !Number.isFinite(buffer.duration) ||
          buffer.duration <= 0 ||
          buffer.length <= 0
        ) {
          throw new Error('Decoded audio has no playable duration');
        }
        if (cancelled) {
          return;
        }
        decodedBufferRef.current = buffer;
        setDuration(buffer.duration);
        setDecodedVersion(v => v + 1);
      } catch (e) {
        if (!cancelled) {
          setDecodeError(true);
          logger.error(
            `SimulationAudioPlayer: decodeAudioData failed — ${String(e)}`,
          );
          onPlaybackLoadErrorRef.current?.();
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopSource();
      decodedBufferRef.current = null;
      ctx.close().catch(() => {});
      audioContextRef.current = null;
      setIsLoading(false);
    };
  }, [audioUrl, stopSource]);

  // Start/stop AudioBufferSourceNode when play state changes
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const ctx = audioContextRef.current;
    const buffer = decodedBufferRef.current;
    if (!ctx || !buffer) {
      setIsPlaying(false);
      return;
    }

    stopSource();
    AudioManager.setAudioSessionActivity(true).catch(() => {});
    ctx.resume().catch(() => {});

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const offset = pausePositionRef.current;
    playStartCtxTimeRef.current = ctx.currentTime;
    offsetAtPlayStartRef.current = offset;

    src.onEnded = () => {
      sourceRef.current = null;
      setIsPlaying(false);
      pausePositionRef.current = buffer.duration;
      setCurrentTime(buffer.duration);
      onProgressRef.current(buffer.duration);
    };

    src.start(0, offset);
    sourceRef.current = src;

    return () => {
      stopSource();
    };
  }, [isPlaying, decodedVersion, playbackGeneration, stopSource]);

  // Progress ticks
  useEffect(() => {
    if (!isPlaying || duration <= 0) {
      return;
    }
    const id = setInterval(() => {
      const ctx = audioContextRef.current;
      if (!ctx || !sourceRef.current) {
        return;
      }
      const elapsed = ctx.currentTime - playStartCtxTimeRef.current;
      const t = Math.min(duration, offsetAtPlayStartRef.current + elapsed);
      setCurrentTime(t);
      pausePositionRef.current = t;
      onProgressRef.current(t);
    }, 200);
    return () => clearInterval(id);
  }, [isPlaying, duration]);

  // External seek (transcript tap): seek then start playback
  useEffect(() => {
    if (externalSeek === null || externalSeek === undefined) {
      return;
    }
    handleSeek(externalSeek.seconds);
    setIsPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSeek?.key]);

  const handlePlayPause = () => {
    if (decodeError) {
      return;
    }
    setIsPlaying(p => !p);
  };

  const clampToAllowedRange = useCallback(
    (time: number) => {
      const dur = duration || time;
      return Math.max(0, Math.min(time, dur));
    },
    [duration],
  );

  const handleSeek = useCallback(
    (time: number) => {
      const newTime = clampToAllowedRange(time);
      pausePositionRef.current = newTime;
      setCurrentTime(newTime);
      onProgressRef.current(newTime);
      onSeekRef.current?.(newTime);

      stopSource();
      if (isPlayingRef.current) {
        setPlaybackGeneration(g => g + 1);
      }
    },
    [clampToAllowedRange, stopSource],
  );

  const handleProgressBarPress = (e: GestureResponderEvent) => {
    if (progressBarWidth > 0 && duration > 0) {
      const x = e.nativeEvent.locationX;
      const progress = x / progressBarWidth;
      handleSeek(progress * duration);
    }
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    setProgressBarWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <TouchableOpacity
        onPress={handlePlayPause}
        disabled={decodeError}
        style={styles.playButton}>
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
    paddingVertical: '16@ms',
    paddingHorizontal: '12@ms',
    borderRadius: '8@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '16@ms',
    marginHorizontal: '25@ms',
    paddingRight: '12@ms',
  },
  playButton: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    backgroundColor: colors.ds.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: '17@ms',
    gap: '6@ms',
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '10@ms',
    color: colors.ds.typography.lowEmphasis,
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
