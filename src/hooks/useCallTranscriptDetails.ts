import {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList} from 'react-native';

import {
  ChatMessage,
  useLazyGetChatMessagesQuery,
} from '@/services/callTranscriptApi';
import {useAppSelector} from '@/store/hooks';
import {selectSummaryData} from '@/store/slices/summarySlice';

const LIMIT = 40;

export const useCallSummaryDetails = (chatId: string) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const listRef = useRef<FlatList>(null);
  const currentRequestRef = useRef<{id: string; offset: number} | null>(null);
  const processedDataRef = useRef<Set<string>>(new Set());
  const lastChatIdRef = useRef<string | null>(null);

  const [getChatMessages, {data, isLoading, isFetching}] =
    useLazyGetChatMessagesQuery();

  const summaryData = useAppSelector(selectSummaryData);

  const counselor = summaryData?.counselorId;
  const client = summaryData?.clientId;
  const startedTime = summaryData?.startedAt;

  const fetchMessages = useCallback(
    (currentOffset: number) => {
      if (!hasMore) return;

      const requestKey = `${chatId}-${currentOffset}`;
      if (processedDataRef.current.has(requestKey)) return;

      currentRequestRef.current = {id: chatId, offset: currentOffset};

      getChatMessages({
        id: chatId,
        limit: LIMIT,
        offset: currentOffset,
      });
    },
    [getChatMessages, chatId, hasMore],
  );

  // Initial fetch - only run when chatId changes
  useEffect(() => {
    if (chatId && chatId !== lastChatIdRef.current) {
      lastChatIdRef.current = chatId;
      setMessages([]);
      setOffset(0);
      setHasMore(true);
      processedDataRef.current.clear();

      // Call API directly to avoid dependency issues
      getChatMessages({
        id: chatId,
        limit: LIMIT,
        offset: 0,
      });
    }
  }, [chatId, getChatMessages]);

  // Effect to watch for incoming data
  useEffect(() => {
    if (data && currentRequestRef.current) {
      const {id, offset: currentOffset} = currentRequestRef.current;
      const requestKey = `${id}-${currentOffset}`;

      // Check if we've already processed this data
      if (processedDataRef.current.has(requestKey)) {
        return;
      }

      // Mark this request as processed
      processedDataRef.current.add(requestKey);

      const newMessages = data.filter(
        (message: ChatMessage) => message.type === 'TEXT',
      );

      setMessages(prev => [...prev, ...newMessages]);

      // Update offset for next fetch
      setOffset(currentOffset + LIMIT);

      // Check if we have more data
      if (data.length < LIMIT) {
        setHasMore(false);
      }

      // Clear current request
      currentRequestRef.current = null;
    }
  }, [data]);

  const handleEndReached = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchMessages(offset);
    }
  }, [isLoading, hasMore, fetchMessages, offset]);

  const formatTimeToMMSS = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = seconds.toString().padStart(2, '0');

    return `${paddedMinutes}.${paddedSeconds}`;
  };

  // Format messages with required information
  const formattedMessages = messages.map(message => ({
    id: message.id,
    message: message.content,
    time: formatTimeToMMSS(
      startedTime
        ? new Date(message.createdAt).getTime() -
            new Date(startedTime).getTime()
        : 0,
    ),
    counselor: message.senderId === counselor,
    client: message.senderId === client,
  }));

  return {
    formattedMessages,
    data,
    isLoading: isLoading,
    isFetching,
    summaryData,
    hasMore,
    handleEndReached,
    listRef,
  };
};
