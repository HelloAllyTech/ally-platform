import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import {VideoRef} from 'react-native-video';

import {TickRoundIcon} from '@/assets';
import {useTranslate, useVideoWatchProgress} from '@/hooks';
import {useReportVideoProgressMutation} from '@/services';
import {colors} from '@/theme';
import {
  StartVideoItemPayload,
  VideoInterjection,
  VideoInterjectionAnsweredState,
} from '@/types';

import {VideoFallbackCard} from './VideoFallbackCard';
import {VideoInterjectionModal} from './VideoInterjectionModal';
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
  const videoRef = useRef<VideoRef>(null);

  // Sorted once per payload so crossing-detection can assume ascending order.
  const interjections = useMemo(
    () =>
      [...(payload.interjections ?? [])].sort(
        (a, b) => a.timestampSeconds - b.timestampSeconds,
      ),
    [payload.interjections],
  );
  const [answeredMap, setAnsweredMap] = useState<
    Record<string, VideoInterjectionAnsweredState>
  >(() => {
    const seed: Record<string, VideoInterjectionAnsweredState> = {};
    (payload.interjections ?? []).forEach(i => {
      if (i.answered) seed[i.id] = i.answered;
    });
    return seed;
  });
  const [activeInterjection, setActiveInterjection] =
    useState<VideoInterjection | null>(null);
  // Playhead position as of the last progress check — used to detect a
  // forward crossing of an interjection's timestamp (a seek backward past
  // one should not retrigger it).
  const lastCheckedTimeRef = useRef(0);

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

  /**
   * Feeds the watch-progress tracker as before, and additionally checks for
   * a forward crossing of the next unanswered interjection. While the modal
   * is up the video is already paused, so no further crossing is checked
   * until it is dismissed. On a crossing, `lastCheckedTimeRef` is rewound to
   * that interjection's own timestamp (not the raw playhead) so any further
   * interjections between it and the current position are still caught once
   * the learner resumes.
   */
  const handleProgressTime = (timeSeconds: number) => {
    recordTime(timeSeconds);

    if (activeInterjection) return;

    const last = lastCheckedTimeRef.current;
    const crossed = interjections.find(
      i =>
        !answeredMap[i.id] &&
        i.timestampSeconds > last &&
        i.timestampSeconds <= timeSeconds,
    );

    if (crossed) {
      lastCheckedTimeRef.current = crossed.timestampSeconds;
      videoRef.current?.pause();
      setActiveInterjection(crossed);
    } else {
      lastCheckedTimeRef.current = timeSeconds;
    }
  };

  const handleInterjectionAnswered = (
    interjectionId: string,
    passed: boolean,
    pointsAwarded?: number,
  ) => {
    setAnsweredMap(prev => ({
      ...prev,
      [interjectionId]: {passed, pointsAwarded},
    }));
  };

  const handleInterjectionContinue = () => {
    setActiveInterjection(null);
    videoRef.current?.resume();
  };

  return (
    <View style={styles.container}>
      {payload.source === 's3' ? (
        <VideoPlayer
          ref={videoRef}
          url={payload.url}
          onProgressTime={handleProgressTime}
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

      {payload.source === 's3' && (
        <VideoInterjectionModal
          interjection={activeInterjection}
          itemId={itemId}
          onAnswered={handleInterjectionAnswered}
          onContinue={handleInterjectionContinue}
        />
      )}
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
