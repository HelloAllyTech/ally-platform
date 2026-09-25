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
import {AsyncStorageKeys} from '@/constants/asyncStorage';
import {colors, fontFamily} from '@/theme';
import {formatTimeToMMSS} from '@/utils';
import {
  getItem as getStoredItem,
  setItem as setStoredItem,
} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

const REMOTE_AUDIO_FETCH_INIT: RequestInit = {
  headers: {
    'User-Agent': 'AllyMobile/1.0 (React Native; simulation feedback)',
    Accept: 'application/ogg,audio/ogg,audio/*,*/*',
  },
};

/**
 * Selectable review speeds. Kept at or below 3x: the native pitch-corrected
 * path clamps `playbackRate` to [0, 3] and sizes its stretch bus for 3x, so
 * anything faster would be silently clamped.
 */
const PLAYBACK_RATES = [1, 1.5, 2, 2.5] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];
const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1;

const isPlaybackRate = (value: unknown): value is PlaybackRate =>
  PLAYBACK_RATES.includes(value as PlaybackRate);

const formatPlaybackRate = (rate: PlaybackRate) => `${rate}x`;

/**
 * Pitch correction (time-stretching) keeps sped-up speech intelligible instead
 * of chipmunked, but it routes audio through the stretcher and adds latency —
 * so 1x deliberately stays on the untouched resampling path. The flag is fixed
 * when the source node is built, which is why crossing this boundary is the one
 * rate change that has to rebuild the node rather than retune it live.
 */
const needsPitchCorrection = (rate: PlaybackRate) => rate !== 1;

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
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(
    DEFAULT_PLAYBACK_RATE,
  );

  const audioContextRef = useRef<AudioContext | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<ReturnType<
    AudioContext['createBufferSource']
  > | null>(null);
  // Anchor for the position math: buffer offset that was playing at
  // `playStartCtxTimeRef`, plus the rate in force since that instant. Every
  // rate change re-anchors all three together (see `applyPlaybackRate`).
  const playStartCtxTimeRef = useRef(0);
  const offsetAtPlayStartRef = useRef(0);
  const playbackRateRef = useRef<PlaybackRate>(DEFAULT_PLAYBACK_RATE);
  // Rate the live source node was constructed with, so we can tell whether a
  // new rate keeps the same pitch-correction mode.
  const sourceRateRef = useRef<PlaybackRate>(DEFAULT_PLAYBACK_RATE);
  // Set once the rate is settled, so a slow AsyncStorage read can never
  // overwrite a speed the user already tapped.
  const rateSettledRef = useRef(false);
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

  /**
   * Where in the buffer we are, in buffer seconds.
   *
   * The context clock runs in wall time, so elapsed wall time has to be scaled
   * by the playback rate to become buffer time. This is only ever the rate since
   * the last anchor, because `applyPlaybackRate` re-anchors on every change.
   */
  const currentPosition = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !isPlayingRef.current || !sourceRef.current) {
      return pausePositionRef.current;
    }
    const elapsedWallTime = ctx.currentTime - playStartCtxTimeRef.current;
    return (
      offsetAtPlayStartRef.current + elapsedWallTime * playbackRateRef.current
    );
  }, []);

  /** Re-base the position math on `position` as of right now. */
  const anchorAt = useCallback((position: number) => {
    const ctx = audioContextRef.current;
    playStartCtxTimeRef.current = ctx ? ctx.currentTime : 0;
    offsetAtPlayStartRef.current = position;
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

    // Read the rate from the ref, not state: `applyPlaybackRate` updates the ref
    // synchronously before triggering this effect, so there is no stale closure.
    const rate = playbackRateRef.current;
    const src = ctx.createBufferSource({
      pitchCorrection: needsPitchCorrection(rate),
    });
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(ctx.destination);
    sourceRateRef.current = rate;

    const offset = pausePositionRef.current;
    anchorAt(offset);

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
  }, [isPlaying, decodedVersion, playbackGeneration, stopSource, anchorAt]);

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
      const t = Math.min(duration, currentPosition());
      setCurrentTime(t);
      pausePositionRef.current = t;
      onProgressRef.current(t);
    }, 200);
    return () => clearInterval(id);
  }, [isPlaying, duration, currentPosition]);

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
    if (!isPlaying && duration > 0 && pausePositionRef.current >= duration) {
      pausePositionRef.current = 0;
      setCurrentTime(0);
      onProgressRef.current(0);
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

  const applyPlaybackRate = useCallback(
    (nextRate: PlaybackRate, persist = true) => {
      const previousRate = playbackRateRef.current;
      rateSettledRef.current = true;
      if (nextRate === previousRate) {
        return;
      }

      // 1. Freeze the position reached under the OLD rate, before the rate ref
      //    moves. Everything downstream resumes from exactly this point.
      const position = clampToAllowedRange(currentPosition());
      pausePositionRef.current = position;
      setCurrentTime(position);

      // 2. Swap the rate. The ref moves first and synchronously, so the tick and
      //    the playback effect both see the new rate immediately.
      playbackRateRef.current = nextRate;
      setPlaybackRate(nextRate);
      if (persist) {
        // Fire-and-forget: setStoredItem logs and swallows its own failures, and
        // a preference that fails to save must not block playback.
        setStoredItem(AsyncStorageKeys.AUDIO_PLAYBACK_RATE, nextRate);
      }

      // 3. While paused there is nothing to retune — the next `start()` reads
      //    the ref and picks up both the rate and the pitch-correction mode.
      if (!isPlayingRef.current) {
        return;
      }

      if (
        needsPitchCorrection(nextRate) !==
        needsPitchCorrection(sourceRateRef.current)
      ) {
        // Pitch correction is fixed at construction, so this crossing needs a
        // fresh node. The playback effect rebuilds from `pausePositionRef` and
        // re-anchors, same path a seek already takes.
        setPlaybackGeneration(g => g + 1);
        return;
      }

      // Same pitch-correction mode: retune the live node. `playbackRate` is a
      // k-rate AudioParam re-read every render quantum, so this takes effect
      // without restarting. Re-anchor so elapsed wall time is scaled by the new
      // rate only from this instant forward.
      anchorAt(position);
      const src = sourceRef.current;
      if (src) {
        src.playbackRate.value = nextRate;
      }
    },
    [anchorAt, clampToAllowedRange, currentPosition],
  );

  const handleCyclePlaybackRate = useCallback(() => {
    const nextIndex =
      (PLAYBACK_RATES.indexOf(playbackRateRef.current) + 1) %
      PLAYBACK_RATES.length;
    applyPlaybackRate(PLAYBACK_RATES[nextIndex]);
  }, [applyPlaybackRate]);

  const applyPlaybackRateRef = useRef(applyPlaybackRate);
  useEffect(() => {
    applyPlaybackRateRef.current = applyPlaybackRate;
  }, [applyPlaybackRate]);

  // Restore the last speed the user picked. Runs exactly once per player
  // instance — it reads the callback through a ref so that re-identifying
  // `applyPlaybackRate` (it closes over `duration`) cannot re-trigger the read.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getStoredItem<unknown>(
        AsyncStorageKeys.AUDIO_PLAYBACK_RATE,
      );
      if (cancelled || rateSettledRef.current) {
        return;
      }
      if (isPlaybackRate(stored)) {
        // Route through applyPlaybackRate so a hydration that lands after
        // playback started still retunes the live node instead of only moving
        // the label. Not persisted — this value came from storage.
        applyPlaybackRateRef.current(stored, false);
      }
      rateSettledRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <ActivityIndicator
            testID="loading-indicator"
            color={colors.ds.theme.primary}
            size="small"
          />
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
        onPress={handleCyclePlaybackRate}
        disabled={decodeError}
        accessibilityRole="button"
        style={styles.speedButton}>
        <Text style={styles.speedButtonText}>
          {formatPlaybackRate(playbackRate)}
        </Text>
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
  speedButton: {
    minWidth: '34@ms',
    height: '24@ms',
    paddingHorizontal: '6@ms',
    borderRadius: '12@ms',
    backgroundColor: colors.ds.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '8@ms',
  },
  speedButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '10@ms',
    color: colors.ds.theme.primary,
  },
  progressGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: '10@ms',
    gap: '6@ms',
  },
  timeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '10@ms',
    color: colors.ds.typography.lowEmphasis,
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
