import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Text, View} from 'react-native';
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
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>
          {t('SimulationFeedback.annotatedTranscription')}
        </Text>
      </View>
      <View style={styles.divider} />
      <FlatList
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
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    marginVertical: '10@vs',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '16@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.white,
    shadowColor: colors.ds.grey[900],
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginHorizontal: '10@ms',
  },
  titleContainer: {
    width: '100%',
    marginBottom: '16@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.25@ms',
    lineHeight: '20@vs',
  },
  divider: {
    height: '0.5@ms',
    backgroundColor: colors.ds.stroke.primary,
    width: '100%',
    marginBottom: '16@vs',
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
