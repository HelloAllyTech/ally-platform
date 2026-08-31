import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CustomDropdown, useErrorToast, useToast} from '@/components';
import {EmptyTranscript} from '@/components/EmptyTranscript/EmptyTranscript';
import {TRANSCRIPT_LANGUAGE_OPTIONS} from '@/constants';
import {useSimulationTranscriptDetails} from '@/hooks/useSimulationTranscriptDetails';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily} from '@/theme';
import {SimulationTranscriptMessage, TranscriptFocusRequest} from '@/types';
import {logger} from '@/utils/logger';

import {
  SimulationAudioPlayer,
  type ExternalSeekRequest,
} from '../SimulationAudioPlayer/SimulationAudioPlayer';
import {SimulationTranscriptItem} from '../SimulationTranscriptItem';
import {SummaryCard} from '../SummaryCard';

/**
 * How long a jumped-to moment stays visibly marked. Long enough to catch the
 * eye once the scroll settles, short enough that it reads as "here it is"
 * rather than as a selection the reader now has to dismiss (web parity).
 */
const FOCUS_HIGHLIGHT_MS = 2500;

export const SimulationTranscript: React.FC<{
  sessionId: string;
  startedAt?: string;
  agentName?: string;
  audioUrl?: string;
  recordingUrlLoading?: boolean;
  onRecordingPlaybackFailed?: () => void;
  /**
   * A moment to scroll to and mark — raised by the "See this moment" chips in
   * Ally's debrief note. The transcript pages in, so a moment further down the
   * session may not be loaded yet: this chases pages until it turns up or the
   * transcript runs out.
   */
  focusMessage?: TranscriptFocusRequest | null;
}> = ({
  sessionId,
  startedAt,
  agentName,
  audioUrl,
  recordingUrlLoading = false,
  onRecordingPlaybackFailed,
  focusMessage,
}) => {
  const {t} = useTranslate();
  const {showErrorToast} = useErrorToast();
  const {showToast} = useToast();
  const [transcriptLanguage, setTranscriptLanguage] = useState('en');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const {
    formattedMessages,
    isLoading,
    isFetching,
    isError,
    error,
    listRef,
    handleEndReached,
    hasMore,
  } = useSimulationTranscriptDetails(sessionId, startedAt, transcriptLanguage);

  const getTranscriptLanguageLabel = useCallback(
    (code: string) =>
      TRANSCRIPT_LANGUAGE_OPTIONS.find(o => o.code === code)?.label ??
      'English (Original)',
    [],
  );

  const getTranscriptLanguageCode = useCallback(
    (label: string) =>
      TRANSCRIPT_LANGUAGE_OPTIONS.find(o => o.label === label)?.code ?? 'en',
    [],
  );

  useEffect(() => {
    if (isError) {
      showErrorToast(error, 'postSim.tabs.transcriptTranslationFailed');
    }
  }, [isError, error, showErrorToast]);

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

  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const handledFocusRequestRef = useRef<number | null>(null);
  const focusHighlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Moment chase: the requested message may sit on a page that hasn't loaded
  // yet, so page forward until it turns up — mirrors the seek chase above,
  // where each new page re-triggers this effect.
  useEffect(() => {
    if (!focusMessage) {
      return;
    }
    if (handledFocusRequestRef.current === focusMessage.requestId) {
      return;
    }

    const targetId = String(focusMessage.messageId);
    const index = formattedMessages.findIndex(
      message => String(message.id) === targetId,
    );

    if (index !== -1) {
      handledFocusRequestRef.current = focusMessage.requestId;
      setFocusedMessageId(targetId);
      try {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.3,
        });
      } catch {
        // onScrollToIndexFailed below retries once layout catches up.
        logger.error('SimulationTranscript: scrollToIndex failed for moment');
      }
      return;
    }

    if (hasMore) {
      if (!isLoading && !isFetching) {
        handleEndReached();
      }
      return;
    }

    // Every page is loaded and the moment is in none of them. Ally only
    // anchors moments it could resolve, so this is the rare edge (e.g. a
    // translated transcript that dropped a turn) — say the jump didn't land
    // rather than leaving the learner at the top of the transcript wondering.
    handledFocusRequestRef.current = focusMessage.requestId;
    showToast(t('postSim.debrief.momentNotFound'), 'error');
  }, [
    focusMessage,
    formattedMessages,
    hasMore,
    isLoading,
    isFetching,
    handleEndReached,
    listRef,
    showToast,
    t,
  ]);

  // Let the highlight expire on its own once the scroll has landed.
  useEffect(() => {
    if (!focusedMessageId) {
      return;
    }
    focusHighlightTimerRef.current = setTimeout(
      () => setFocusedMessageId(null),
      FOCUS_HIGHLIGHT_MS,
    );
    return () => {
      if (focusHighlightTimerRef.current) {
        clearTimeout(focusHighlightTimerRef.current);
      }
    };
  }, [focusedMessageId]);

  const renderItem = ({
    item,
    index,
  }: {
    item: SimulationTranscriptMessage;
    index: number;
  }) => {
    const {id, time, message, isLearner, startSeconds} = item;
    const speakerLabel = isLearner
      ? t('transcription.youLabel')
      : agentName
        ? `${agentName} (${t('transcription.aiClientSuffix')})`
        : t('transcription.aiClientSuffix');

    return (
      <SimulationTranscriptItem
        time={time}
        message={message}
        speakerLabel={speakerLabel}
        isActive={index === activeIndex}
        isFocused={focusedMessageId !== null && String(id) === focusedMessageId}
        onPress={() => queueSeekToSeconds(startSeconds)}
        isLearner={isLearner}
      />
    );
  };

  const hasTranscript = formattedMessages.length > 0;
  const isInitialTranscriptLoading =
    (isLoading || isFetching) && !hasTranscript;
  // Recording and transcript load independently; show a single combined
  // spinner for the card instead of one per data source.
  const showCombinedLoader = recordingUrlLoading || isInitialTranscriptLoading;

  const renderEmptyComponent = () => {
    if (showCombinedLoader) {
      return null;
    }
    return <EmptyTranscript />;
  };

  return (
    <SummaryCard
      title={t('postSim.tabs.transcript')}
      titleRight={
        <View style={styles.languagePicker}>
          <CustomDropdown
            value={getTranscriptLanguageLabel(transcriptLanguage)}
            options={TRANSCRIPT_LANGUAGE_OPTIONS.map(o => o.label)}
            onSelect={label =>
              setTranscriptLanguage(getTranscriptLanguageCode(label))
            }
            isOpen={isLanguageDropdownOpen}
            setIsOpen={setIsLanguageDropdownOpen}
            alignModalRight
            fixedWidth={140}
          />
        </View>
      }>
      {showCombinedLoader ? (
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
          {t('postSim.noSessionRecording')}
        </Text>
      )}
      <Text style={styles.transcriptDisclaimer}>
        {t('transcription.accuracyDisclaimer')}
      </Text>
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
  languagePicker: {
    maxWidth: '140@ms',
    minWidth: '110@ms',
  },
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
  transcriptDisclaimer: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.mediumEmphasis,
    marginHorizontal: 0,
    marginBottom: '8@ms',
  },
  contentContainer: {
    paddingBottom: '100@mvs',
  },
});
