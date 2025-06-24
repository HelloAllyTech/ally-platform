import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList} from 'react-native';

import {
  ChatMessage,
  useLazyGetChatMessagesQuery,
} from '@/services/callTranscriptApi';
import {useAppSelector} from '@/store/hooks';
import {selectSummaryData} from '@/store/slices/summarySlice';

const LIMIT = 20;

export const useCallTranscriptDetails = (chatId: number) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<FlatList>(null);

  const [getChatMessages, {data, isLoading, isFetching}] =
    useLazyGetChatMessagesQuery();

  const summaryData = useAppSelector(selectSummaryData);
  const counselor = summaryData?.counselorId;
  const client = summaryData?.clientId;
  const startedTime = summaryData?.startedAt;

  const queryParams = useMemo(
    () => ({
      id: chatId,
      limit: LIMIT,
      sortOrder: 'ASC',
    }),
    [chatId],
  );

  // Process data only if it's for a new offset
  useEffect(() => {
    if (data) {
      const newMessages = data.data;

      setMessages(prev => {
        const updated = [...prev, ...newMessages];
        if (updated.length >= data.count) {
          setHasMore(false);
        }
        return updated;
      });
    }
  }, [data]);

  // Reset state and load first page on chatId change
  useEffect(() => {
    if (!chatId) return;

    setMessages([]);
    setHasMore(true);
    setOffset(0);

    getChatMessages({
      ...queryParams,
      offset: 0,
    });
  }, [chatId, getChatMessages, queryParams]);

  const fetchMessages = useCallback(
    (currentOffset: number) => {
      if (!hasMore) return;

      getChatMessages({
        ...queryParams,
        offset: currentOffset,
      });

      setOffset(currentOffset + LIMIT);
    },
    [getChatMessages, hasMore, queryParams],
  );

  const handleEndReached = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchMessages(offset);
    }
  }, [isLoading, hasMore, fetchMessages, offset]);

  const formatTimeToMMSS = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes.toString().padStart(2, '0')}.${seconds
      .toString()
      .padStart(2, '0')}`;
  };

  const formattedMessages = useMemo(
    () =>
      messages.map(message => ({
        id: message.messageId,
        message: message.content,
        time: formatTimeToMMSS(
          startedTime
            ? new Date(message.createdAt).getTime() -
                new Date(startedTime).getTime()
            : 0,
        ),
        counselor: message.senderId === counselor,
        client: message.senderId === client || message.senderId === -1,
      })),
    [messages, startedTime, counselor, client],
  );

  return {
    formattedMessages,
    data,
    isLoading,
    isFetching,
    summaryData,
    hasMore,
    handleEndReached,
    listRef,
  };
};
