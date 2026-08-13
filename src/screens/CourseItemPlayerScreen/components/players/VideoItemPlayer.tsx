import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {TickRoundIcon} from '@/assets';
import {useTranslate, useVideoWatchProgress} from '@/hooks';
import {useReportVideoProgressMutation} from '@/services';
import {colors} from '@/theme';
import {StartVideoItemPayload} from '@/types';

import {VideoFallbackCard} from './VideoFallbackCard';
import {VideoPlayer} from './VideoPlayer';

export interface VideoItemPlayerProps {
  payload: StartVideoItemPayload;
  itemId: string;
  trackId: string;
  alreadyCompleted: boolean;
}

/**
 * Video item: native playback + watch tracking for `s3` sources, an
 * open-externally-and-mark-watched fallback for youtube/vimeo/loom (see
 * `VideoFallbackCard`). Mirrors ally-web's `VideoItemPlayer`.
 */
export const VideoItemPlayer: React.FC<VideoItemPlayerProps> = ({
  payload,
  itemId,
  trackId,
  alreadyCompleted,
}) => {
  const {t} = useTranslate();
  const [reportVideoProgress] = useReportVideoProgressMutation();
  const [completed, setCompleted] = useState(alreadyCompleted);

  const {recordTime, flush, watchedPct} = useVideoWatchProgress({
    durationSeconds: payload.durationSeconds,
    initialMaxWatchedPct: payload.maxWatchedPct ?? 0,
    disabled: completed,
    onReport: async pct => {
      try {
        const result = await reportVideoProgress({
          itemId,
          trackId,
          watchedPct: pct,
        }).unwrap();
        if (result.completed) setCompleted(true);
      } catch {
        // Monotonic server-side; a dropped report is recovered by the next.
      }
    },
  });

  useEffect(() => () => flush(), [flush]);

  const handleMarkWatched = async () => {
    try {
      const result = await reportVideoProgress({
        itemId,
        trackId,
        watchedPct: 100,
      }).unwrap();
      if (result.completed) setCompleted(true);
    } catch {
      // Button stays available so the learner can retry.
    }
  };

  return (
    <View style={styles.container}>
      {payload.source === 's3' ? (
        <VideoPlayer
          url={payload.url}
          onProgressTime={recordTime}
          onPauseOrEnd={flush}
        />
      ) : (
        <VideoFallbackCard
          url={payload.url}
          onMarkWatched={handleMarkWatched}
        />
      )}

      <View style={styles.footer}>
        {completed ? (
          <View style={styles.watchedChip}>
            <TickRoundIcon
              width={16}
              height={16}
              color={colors.ds.green[700]}
            />
            <Text style={styles.watchedChipText}>
              {t('courses.video.watched')}
            </Text>
          </View>
        ) : (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, {width: `${watchedPct}%`}]} />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  footer: {
    borderTopWidth: 0.5,
    borderTopColor: colors.ds.stroke.primary,
    padding: '16@ms',
    alignItems: 'center',
  },
  watchedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
  },
  watchedChipText: {
    color: colors.ds.green[700],
  },
  progressTrack: {
    width: '128@ms',
    height: '6@ms',
    borderRadius: '3@ms',
    backgroundColor: colors.ds.grey[200],
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.ds.theme.primary,
  },
});
