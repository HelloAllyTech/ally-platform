import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList} from 'react-native';

import {SortOrder} from '@/constants';
import {
  SimulationMessage,
  useLazyGetSimulationMessagesQuery,
} from '@/services/simulationTranscriptApi';
import {SimulationTranscriptMessage} from '@/types';
import {formatTimeToMMSS} from '@/utils';

const LIMIT = 10;

export const useSimulationTranscriptDetails = (
  scenarioSessionId: string,
  sessionStartedAt?: string,
) => {
  const [messages, setMessages] = useState<SimulationMessage[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<FlatList>(null);

  const [getMessages, {data, isLoading, isFetching}] =
    useLazyGetSimulationMessagesQuery();

  const queryParams = useMemo(
    () => ({
      scenarioSessionId,
      limit: LIMIT,
      sortOrder: SortOrder.ASC,
      sortBy: 'createdAt',
    }),
    [scenarioSessionId],
  );

  useEffect(() => {
    if (data) {
      const newMessages = data.messages || [];
      setMessages(prev => {
        const updated = [...prev, ...newMessages];
        if (typeof data.count === 'number' && updated.length >= data.count) {
          setHasMore(false);
        }
        return updated;
      });
    }
  }, [data]);

  // Reset and load first page on id change
  useEffect(() => {
    if (!scenarioSessionId) return;

    setMessages([]);
    setHasMore(true);
    setOffset(0);

    getMessages({
      ...queryParams,
      offset: 0,
    });
  }, [scenarioSessionId, getMessages, queryParams]);

  const fetchMessages = useCallback(
    (currentOffset: number) => {
      if (!hasMore) return;

      getMessages({
        ...queryParams,
        offset: currentOffset,
      });

      setOffset(currentOffset + LIMIT);
    },
    [getMessages, hasMore, queryParams],
  );

  const handleEndReached = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchMessages(offset);
    }
  }, [isLoading, hasMore, fetchMessages, offset]);

  const formattedMessages = useMemo<SimulationTranscriptMessage[]>(() => {
    return messages.map(message => ({
      id: message.id,
      message: message.content,
      startSeconds:
        typeof message.startSeconds === 'number' ? message.startSeconds : 0,
      time: formatTimeToMMSS(
        typeof message.startSeconds === 'number' && message.startSeconds >= 0
          ? Math.round(message.startSeconds * 1000)
          : sessionStartedAt
            ? new Date(message.createdAt).getTime() -
              new Date(sessionStartedAt).getTime()
            : 0,
      ),
      isLearner: message.senderId !== -1,
      tags: message.tags,
    }));
  }, [messages, sessionStartedAt]);

  return {
    formattedMessages,
    rawData: data,
    isLoading,
    isFetching,
    hasMore,
    handleEndReached,
    listRef,
  };
};
