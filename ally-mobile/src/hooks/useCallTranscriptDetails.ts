import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList} from 'react-native';

import {SortOrder} from '@/constants';
import {
  ChatMessage,
  useLazyGetChatMessagesQuery,
} from '@/services/callTranscriptApi';
import {useAppSelector} from '@/store/hooks';
import {selectSummaryData} from '@/store/slices/summarySlice';
import {CallTranscriptMessage, ChatProvider} from '@/types';
import {formatTimeToMMSS} from '@/utils/date';

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
  const startedTime = summaryData?.createdAt;

  const queryParams = useMemo(
    () => ({
      id: chatId,
      limit: LIMIT,
      sortOrder: SortOrder.ASC,
      sortBy:
        summaryData?.details?.callInfo?.provider === ChatProvider.WEBRTC
          ? 'createdAt'
          : 'startSeconds',
    }),
    [chatId, summaryData?.details?.callInfo?.provider],
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

  const formattedMessages = useMemo<CallTranscriptMessage[]>(
    () =>
      messages.map(message => ({
        id: message.messageId,
        message: message.content,
        time: formatTimeToMMSS(
          summaryData?.details?.callInfo?.provider === ChatProvider.WEBRTC
            ? startedTime
              ? new Date(message.createdAt).getTime() -
                new Date(startedTime).getTime()
              : 0
            : (message.startSeconds || 0) * 1000, // For microphone/Exotel, use startSeconds
        ),
        counselor: message.senderId === counselor,
        client: message.senderId === client || message.senderId === -1,
      })),
    [
      messages,
      startedTime,
      counselor,
      client,
      summaryData?.details?.callInfo?.provider,
    ],
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
