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
  languageCode?: string,
) => {
  const [messages, setMessages] = useState<SimulationMessage[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<FlatList>(null);
  const pagingLockRef = useRef(false);

  const [getMessages, {data, isLoading, isFetching, isError, error}] =
    useLazyGetSimulationMessagesQuery();

  const queryParams = useMemo(
    () => ({
      scenarioSessionId,
      limit: LIMIT,
      sortOrder: SortOrder.ASC,
      sortBy: 'startSeconds',
      languageCode,
    }),
    [scenarioSessionId, languageCode],
  );

  const applyResult = useCallback(
    (
      append: boolean,
      result?: {messages: SimulationMessage[]; count: number},
    ) => {
      const newMessages = result?.messages || [];
      setMessages(prev => {
        const base = append ? prev : [];
        const seenIds = new Set(base.map(m => m.id));
        const deduped = newMessages.filter(m => {
          if (seenIds.has(m.id)) return false;
          seenIds.add(m.id);
          return true;
        });
        const updated = [...base, ...deduped];
        const reachedCount =
          typeof result?.count === 'number' && updated.length >= result.count;
        // An empty page means the server has no more data. A non-empty page
        // that dedupes down to nothing (append only) means we looped back
        // onto data we already have - stop instead of refetching forever.
        const noNewData =
          newMessages.length === 0 || (append && deduped.length === 0);
        if (reachedCount || noNewData) {
          setHasMore(false);
        }
        return updated;
      });
    },
    [],
  );

  // Reset and load first page on id/language change. The existing message
  // list is kept until the new page arrives so a failed request (e.g. an
  // unsupported translation) doesn't blank out an already-loaded transcript.
  useEffect(() => {
    if (!scenarioSessionId) return;

    setHasMore(true);
    setOffset(0);
    pagingLockRef.current = true;

    let cancelled = false;
    getMessages({...queryParams, offset: 0})
      .unwrap()
      .then(result => {
        if (!cancelled) applyResult(false, result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) pagingLockRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [scenarioSessionId, getMessages, queryParams, applyResult]);

  const fetchMessages = useCallback(
    (currentOffset: number) => {
      if (!hasMore || pagingLockRef.current) return;
      pagingLockRef.current = true;

      getMessages({
        ...queryParams,
        offset: currentOffset,
      })
        .unwrap()
        .then(result => {
          applyResult(true, result);
          // Only advance past this page once it has actually landed, so a
          // failed fetch can be retried at the same offset instead of the
          // page being silently skipped.
          setOffset(currentOffset + LIMIT);
        })
        .catch(() => {})
        .finally(() => {
          pagingLockRef.current = false;
        });
    },
    [getMessages, hasMore, queryParams, applyResult],
  );

  const handleEndReached = useCallback(() => {
    if (!isLoading && !isFetching && hasMore && !pagingLockRef.current) {
      fetchMessages(offset);
    }
  }, [isLoading, isFetching, hasMore, fetchMessages, offset]);

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
    }));
  }, [messages, sessionStartedAt]);

  return {
    formattedMessages,
    rawData: data,
    isLoading,
    isFetching,
    isError,
    error,
    hasMore,
    handleEndReached,
    listRef,
  };
};
