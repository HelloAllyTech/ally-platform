import {useCallback, useRef, useState} from 'react';

import {
  MAX_MESSAGES,
  MOCK_AI_RESPONSES,
  MOCK_RESPONSE_DELAY_MS,
  MOCK_STREAM_INTERVAL_MS,
} from './constants';
import {AskAIChatMessage, ChatMessageRole} from './types';

/**
 * Hook that manages the Ask AI chat state with mock streaming responses.
 *
 * Architecture note:
 * -----------------
 * This hook isolates all chat logic (state, sending, streaming) from the UI.
 * When the real WebSocket BE is ready, replace the `simulateMockResponse`
 * internals with actual socket events while keeping the same public API:
 *   { messages, isStreaming, isMaxMessagesReached, sendMessage }
 *
 * The component consuming this hook won't need any changes.
 */
export const useAskAIChat = () => {
  const [messages, setMessages] = useState<AskAIChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Track which mock response to use next (index into MOCK_AI_RESPONSES)
  const responseIndexRef = useRef(0);
  // Keep a ref to streaming timers so we can clean up
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMaxMessagesReached = messages.length >= MAX_MESSAGES;

  /**
   * Generate a unique message ID.
   * In production this would come from the BE.
   */
  const generateId = () =>
    `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  /**
   * Get the next mock response, cycling through the array.
   */
  const getNextMockResponse = useCallback((): string => {
    const index = Math.min(
      responseIndexRef.current,
      MOCK_AI_RESPONSES.length - 1,
    );
    responseIndexRef.current += 1;
    return MOCK_AI_RESPONSES[index];
  }, []);

  /**
   * Simulate a streamed AI response word-by-word.
   *
   * When integrating with BE:
   * - Remove the setTimeout / setInterval simulation
   * - Listen to the WebSocket `SEND_MESSAGE` (or a new AI-specific event)
   * - On each incoming chunk, append to the AI message content
   * - On stream-end event, set isStreaming to false
   */
  const simulateMockResponse = useCallback(
    (aiMessageId: string, fullResponse: string) => {
      const words = fullResponse.split(' ');
      let wordIndex = 0;

      // Add an empty AI message that we'll stream into
      setMessages(prev => [
        ...prev,
        {
          id: aiMessageId,
          role: ChatMessageRole.AI,
          content: '',
          isStreaming: true,
        },
      ]);
      setIsStreaming(true);

      // Stream word-by-word
      streamTimerRef.current = setInterval(() => {
        if (wordIndex < words.length) {
          const nextWord = words[wordIndex];
          const separator = wordIndex === 0 ? '' : ' ';

          setMessages(prev =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? {...msg, content: msg.content + separator + nextWord}
                : msg,
            ),
          );
          wordIndex++;
        } else {
          // Streaming complete
          if (streamTimerRef.current) {
            clearInterval(streamTimerRef.current);
            streamTimerRef.current = null;
          }
          setMessages(prev =>
            prev.map(msg =>
              msg.id === aiMessageId ? {...msg, isStreaming: false} : msg,
            ),
          );
          setIsStreaming(false);
        }
      }, MOCK_STREAM_INTERVAL_MS);
    },
    [],
  );

  /**
   * Send a user message and trigger the mock AI response.
   */
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || isMaxMessagesReached) {
        return;
      }

      // Add the user message
      const userMessage: AskAIChatMessage = {
        id: generateId(),
        role: ChatMessageRole.USER,
        content: trimmed,
      };

      setMessages(prev => [...prev, userMessage]);

      // TODO: Remove this limit check after API integration
      // Check if adding the AI response would exceed the limit
      // (user message already added = length + 1, AI will be + 2)
      const currentCount = messages.length + 1; // +1 for the user message we just added
      if (currentCount >= MAX_MESSAGES) {
        return; // No room for an AI response
      }

      // Simulate a delay before the AI starts responding
      const aiMessageId = generateId();
      const fullResponse = getNextMockResponse();

      delayTimerRef.current = setTimeout(() => {
        simulateMockResponse(aiMessageId, fullResponse);
      }, MOCK_RESPONSE_DELAY_MS);
    },
    [
      isStreaming,
      isMaxMessagesReached,
      messages.length,
      getNextMockResponse,
      simulateMockResponse,
    ],
  );

  /**
   * Clean up all timers. Call this when the component unmounts.
   */
  const cleanup = useCallback(() => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return {
    messages,
    isStreaming,
    isMaxMessagesReached,
    sendMessage,
    cleanup,
  };
};
