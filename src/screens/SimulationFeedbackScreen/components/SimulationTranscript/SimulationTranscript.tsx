import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EmptyTranscript} from '@/components/EmptyTranscript/EmptyTranscript';
import {useSimulationTranscriptDetails} from '@/hooks/useSimulationTranscriptDetails';
import {useTranslate} from '@/hooks/useTranslate';
import {useAppSelector} from '@/store/hooks';
import {colors, fontFamily} from '@/theme';
import {SimulationTranscriptMessage} from '@/types';

import {SimulationTranscriptItem} from '../SimulationTranscriptItem';

export const SimulationTranscript: React.FC<{
  sessionId: string;
  startedAt?: string;
  currentTime?: number;
  onSeek?: (time: number) => void;
  agentName?: string;
}> = ({sessionId, startedAt, currentTime, onSeek, agentName}) => {
  const {t} = useTranslate();
  const userName = useAppSelector(state => state.user.user?.name);
  const {formattedMessages, isLoading, listRef, handleEndReached} =
    useSimulationTranscriptDetails(sessionId, startedAt);

  const [activeIndex, setActiveIndex] = useState(-1);
  const isUserScrolling = useRef(false);

  useEffect(() => {
    if (currentTime === undefined || !formattedMessages.length) {
      return;
    }

    // Find the currently active message based on timestamp
    const index = formattedMessages.findIndex((item, i, arr) => {
      const nextItem = arr[i + 1];
      return (
        item.startSeconds <= currentTime &&
        (!nextItem || nextItem.startSeconds > currentTime)
      );
    });

    if (index !== -1 && index !== activeIndex) {
      setActiveIndex(index);

      // Only auto-scroll if the user isn't manually interacting
      if (
        !isUserScrolling.current &&
        listRef.current &&
        index < formattedMessages.length
      ) {
        try {
          listRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.3, // Scroll to top-third of screen for better reading context
          });
        } catch (e) {
          // Ignore scroll errors (e.g. layout not ready)
        }
      }
    }
  }, [currentTime, formattedMessages, activeIndex, listRef]);

  const renderItem = ({
    item,
    index,
  }: {
    item: SimulationTranscriptMessage;
    index: number;
  }) => {
    const {time, message, learner, startSeconds} = item;
    const speaker = learner
      ? userName || t('CallTranscript.you')
      : `${agentName} (${t('CallTranscript.aiClient')})`;

    return (
      <SimulationTranscriptItem
        time={time}
        message={message}
        speakerLabel={speaker}
        isActive={index === activeIndex}
        // onPress={onSeek ? () => onSeek(startSeconds) : undefined}
        isLearner={learner}
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
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      ref={listRef}
      data={formattedMessages || []}
      keyExtractor={item => String(item.id)}
      renderItem={renderItem}
      ListFooterComponent={
        isLoading && formattedMessages?.length > 0 ? (
          <ActivityIndicator color={colors.ds.theme.primary} />
        ) : null
      }
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.1}
      ListEmptyComponent={renderEmptyComponent}
      onScrollBeginDrag={() => (isUserScrolling.current = true)}
      onMomentumScrollEnd={() => (isUserScrolling.current = false)}
      onScrollToIndexFailed={info => {
        // Fallback or retry logic if needed
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
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: '16@ms',
    paddingBottom: '40@vs',
  },
  placeholder: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '15@ms',
  },
  contentContainer: {
    paddingBottom: '100@mvs',
  },
  loadingIndicator: {
    marginTop: '40@vs',
  },
});
