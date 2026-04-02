import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Text} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscript} from '@/components/EmptyTranscript/EmptyTranscript';
import {useSimulationTranscriptDetails} from '@/hooks/useSimulationTranscriptDetails';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily} from '@/theme';
import {SimulationTranscriptMessage} from '@/types';
import {logger} from '@/utils/logger';

import {
  SimulationAudioPlayer,
  type ExternalSeekRequest,
} from '../SimulationAudioPlayer/SimulationAudioPlayer';
import {SimulationTranscriptItem} from '../SimulationTranscriptItem';
import {SummaryCard} from '../SummaryCard';

export const SimulationTranscript: React.FC<{
  sessionId: string;
  startedAt?: string;
  agentName?: string;
  audioUrl?: string;
  recordingUrlLoading?: boolean;
  onRecordingPlaybackFailed?: () => void;
}> = ({
  sessionId,
  startedAt,
  agentName,
  audioUrl,
  recordingUrlLoading = false,
  onRecordingPlaybackFailed,
}) => {
  const {t} = useTranslate();
  const {
    formattedMessages,
    isLoading,
    isFetching,
    listRef,
    handleEndReached,
    hasMore,
  } = useSimulationTranscriptDetails(sessionId, startedAt);

  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [externalSeek, setExternalSeek] = useState<ExternalSeekRequest | null>(
    null,
  );
  const seekKeyRef = useRef(0);

  const trimmedAudioUrl = audioUrl?.trim() ?? '';
  const hasPlayableRecording = trimmedAudioUrl.length > 0;

  // When the user seeks past loaded transcript, this stores the target time.
  // A chase effect then paginates until the transcript covers it (or ends).
  const [pendingSeekTarget, setPendingSeekTarget] = useState<number | null>(
    null,
  );

  const lastLoadedStartSeconds = useMemo(() => {
    if (formattedMessages.length === 0) {
      return -1;
    }
    return Math.max(...formattedMessages.map(m => m.startSeconds));
  }, [formattedMessages]);

  const startChaseIfNeeded = useCallback(
    (seekSeconds: number) => {
      if (hasMore && seekSeconds > lastLoadedStartSeconds) {
        setPendingSeekTarget(seekSeconds);
      }
    },
    [hasMore, lastLoadedStartSeconds],
  );

  // Chase effect: paginates until the target is within loaded transcript or
  // there are no more pages. Each new page updates formattedMessages which
  // re-triggers this effect.
  useEffect(() => {
    if (pendingSeekTarget === null) {
      return;
    }
    if (lastLoadedStartSeconds >= pendingSeekTarget) {
      setPendingSeekTarget(null);
      return;
    }
    if (!hasMore) {
      setPendingSeekTarget(null);
      return;
    }
    if (!isFetching) {
      handleEndReached();
    }
  }, [
    pendingSeekTarget,
    lastLoadedStartSeconds,
    hasMore,
    isFetching,
    handleEndReached,
  ]);

  const queueSeekToSeconds = useCallback(
    (seconds: number) => {
      const raw = Math.max(0, seconds);
      seekKeyRef.current += 1;
      setExternalSeek({key: seekKeyRef.current, seconds: raw});
      startChaseIfNeeded(raw);
    },
    [startChaseIfNeeded],
  );

  /** Called by the audio player on any user-initiated seek (progress bar scrub) */
  const handlePlayerSeek = useCallback(
    (time: number) => {
      startChaseIfNeeded(time);
    },
    [startChaseIfNeeded],
  );

  const [activeIndex, setActiveIndex] = useState(-1);
  const isUserScrolling = useRef(false);

  useEffect(() => {
    if (!formattedMessages.length) {
      return;
    }

    const index = formattedMessages.findIndex((item, i, arr) => {
      const nextItem = arr[i + 1];
      return (
        item.startSeconds <= playbackSeconds &&
        (!nextItem || nextItem.startSeconds > playbackSeconds)
      );
    });

    if (index !== -1 && index !== activeIndex) {
      setActiveIndex(index);

      if (
        !isUserScrolling.current &&
        listRef.current &&
        index < formattedMessages.length
      ) {
        try {
          listRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.3,
          });
        } catch {
          logger.error('SimulationTranscript: scrollToIndex failed');
        }
      }
    }
  }, [playbackSeconds, formattedMessages, activeIndex, listRef]);

  const renderItem = ({
    item,
    index,
  }: {
    item: SimulationTranscriptMessage;
    index: number;
  }) => {
    const {time, message, isLearner, startSeconds, tags} = item;
    const speakerLabel = isLearner
      ? t('CallTranscript.you')
      : agentName
        ? `${agentName} (${t('CallTranscript.aiClient')})`
        : t('CallTranscript.aiClient');

    return (
      <SimulationTranscriptItem
        time={time}
        message={message}
        speakerLabel={speakerLabel}
        isActive={index === activeIndex}
        onPress={() => queueSeekToSeconds(startSeconds)}
        isLearner={isLearner}
        tags={tags}
      />
    );
  };

  const renderEmptyComponent = () => {
    if (isLoading) {
      return (
        <ActivityIndicator
          size="large"
          color={colors.ds.theme.primary}
          style={styles.loadingIndicator}
        />
      );
    }
    return <EmptyTranscript />;
  };

  return (
    <SummaryCard title={t('SimulationFeedback.annotatedTranscription')}>
      {recordingUrlLoading ? (
        <ActivityIndicator
          color={colors.ds.theme.primary}
          size="large"
          style={styles.audioLoadingPlaceholder}
        />
      ) : hasPlayableRecording ? (
        <SimulationAudioPlayer
          audioUrl={trimmedAudioUrl}
          onProgress={setPlaybackSeconds}
          onSeek={handlePlayerSeek}
          externalSeek={externalSeek}
          containerStyle={styles.audioPlayerInCard}
          onPlaybackLoadError={onRecordingPlaybackFailed}
        />
      ) : (
        <Text style={styles.noRecordingText}>
          {t('SimulationFeedback.noSessionRecording')}
        </Text>
      )}
      <FlatList
        contentContainerStyle={styles.contentContainer}
        ref={listRef}
        data={formattedMessages || []}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        ListFooterComponent={
          (isLoading || isFetching) && formattedMessages?.length > 0 ? (
            <ActivityIndicator color={colors.ds.theme.primary} />
          ) : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.1}
        ListEmptyComponent={renderEmptyComponent}
        onScrollBeginDrag={() => (isUserScrolling.current = true)}
        onMomentumScrollEnd={() => (isUserScrolling.current = false)}
        onScrollToIndexFailed={info => {
          setTimeout(() => {
            if (listRef.current) {
              try {
                listRef.current.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.3,
                });
              } catch (e) {}
            }
          }, 100);
        }}
      />
    </SummaryCard>
  );
};

const styles = ScaledSheet.create({
  audioLoadingPlaceholder: {
    marginHorizontal: 0,
    marginBottom: '12@ms',
    minHeight: '56@vs',
    justifyContent: 'center',
  },
  audioPlayerInCard: {
    marginHorizontal: 0,
    marginBottom: '12@ms',
  },
  noRecordingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.mediumEmphasis,
    marginHorizontal: 0,
    marginBottom: '12@ms',
    paddingVertical: '8@ms',
  },
  contentContainer: {
    paddingBottom: '100@mvs',
  },
  loadingIndicator: {
    marginTop: '40@vs',
  },
});
