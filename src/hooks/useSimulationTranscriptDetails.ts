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
      if (newMessages.length === 0) {
        setHasMore(false);
        return;
      }
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
    if (!isLoading && !isFetching && hasMore) {
      fetchMessages(offset);
    }
  }, [isLoading, isFetching, hasMore, fetchMessages, offset]);

  const formattedMessages = useMemo<SimulationTranscriptMessage[]>(() => {
    return messages.map((message, index) => {
      // API startSeconds is actually the segment's end time.
      // Real start = previous message's end time; first message starts at 0.
      const prevEnd = index > 0 ? messages[index - 1].startSeconds : null;
      const derivedStart =
        index === 0 ? 0 : typeof prevEnd === 'number' ? prevEnd : null;

      const startSeconds = derivedStart ?? 0;

      const timeMs =
        derivedStart !== null
          ? Math.round(derivedStart * 1000)
          : sessionStartedAt
            ? new Date(message.createdAt).getTime() -
              new Date(sessionStartedAt).getTime()
            : 0;

      return {
        id: message.id,
        message: message.content,
        startSeconds,
        time: formatTimeToMMSS(Math.max(0, timeMs)),
        isLearner: message.senderId !== -1,
        tags: message.tags,
      };
    });
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
