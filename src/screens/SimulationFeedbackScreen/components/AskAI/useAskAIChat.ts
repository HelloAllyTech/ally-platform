import {useCallback, useEffect, useRef, useState} from 'react';

import {API_ROUTES, APIVersion} from '@/constants';
import {useLazyGetChatHistoryQuery} from '@/services/simulationSummaryApi';
import {logger} from '@/utils/logger';

import {
  AskAIChatMessage,
  ChatMessageRole,
  SSEEvent,
  SSEEventType,
  UseAskAIChatOptions,
} from './types';

const BASE_URL = 'https://unfloatable-nonexcusably-zara.ngrok-free.dev';
const SCENARIO_SESSION_ID = 'b14fae23-e0a9-44a7-a911-edf14498fc53';

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjIsInVzZXJuYW1lIjoiY291bnNlbG9yQGV4YW1wbGUuY29tIiwidGVuYW50SWQiOiIwYzY1OGEwNC03ODYyLTQwNWQtODcyZi0zOTg2MWVlN2UyZDkiLCJpYXQiOjE3NzEzOTUwMDQsImV4cCI6MTc3MTM5NTkwNH0.O6lhlWVO7gWdNc9XZVepmfAHTEQdK2qhQSyJ4iMIRWw';

// ── Helpers ─────────────────────────────────────────────────────

const generateTempId = () =>
  `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const createUserMessage = (content: string): AskAIChatMessage => ({
  id: generateTempId(),
  role: ChatMessageRole.USER,
  content,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const createAssistantMessage = (): AskAIChatMessage => ({
  id: generateTempId(),
  role: ChatMessageRole.ASSISTANT,
  content: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isStreaming: true,
});

// ── SSE Parsing ─────────────────────────────────────────────────

const parseSSELine = (line: string): SSEEvent | null => {
  const prefix = 'data: ';
  if (!line.startsWith(prefix)) {
    return null;
  }
  try {
    return JSON.parse(line.slice(prefix.length)) as SSEEvent;
  } catch {
    return null;
  }
};

/**
 * Parse all complete SSE events from a buffer.
 * Returns the parsed events and any remaining incomplete data.
 */
const parseSSEBuffer = (
  buffer: string,
): {events: SSEEvent[]; remaining: string} => {
  const events: SSEEvent[] = [];
  const parts = buffer.split('\n\n');
  const remaining = parts.pop() || '';

  for (const part of parts) {
    const lines = part.split('\n');
    for (const line of lines) {
      const event = parseSSELine(line.trim());
      if (event) {
        events.push(event);
      }
    }
  }

  return {events, remaining};
};

// ── Hook ────────────────────────────────────────────────────────

export const useAskAIChat = ({
  scenarioSessionId = SCENARIO_SESSION_ID,
}: UseAskAIChatOptions) => {
  const [messages, setMessages] = useState<AskAIChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store the XHR instance so we can abort it on cleanup
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [getChatHistory] = useLazyGetChatHistoryQuery();

  // ── Load chat history on mount ──────────────────────────────

  useEffect(() => {
    if (!scenarioSessionId) {
      return;
    }

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const result = await getChatHistory(scenarioSessionId);
        if (result.data) {
          setMessages(result.data);
        }
      } catch (err) {
        logger.error(`Failed to load chat history: ${err}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [scenarioSessionId, getChatHistory]);

  // ── SSE Streaming via XMLHttpRequest ──────────────────────────
  //
  // React Native's fetch() does not support ReadableStream / getReader().
  // XHR's onprogress fires incrementally as data arrives, which lets us
  // parse SSE events in real time.

  const streamFromSSE = useCallback(
    (userMessageContent: string) => {
      if (!scenarioSessionId) {
        return;
      }

      const assistantMsg = createAssistantMessage();
      setMessages(prev => [...prev, assistantMsg]);
      setIsStreaming(true);
      setError(null);

      const token = ACCESS_TOKEN;
      if (!token) {
        setMessages(prev => prev.filter(msg => msg.id !== assistantMsg.id));
        setError('No access token');
        setIsStreaming(false);
        return;
      }

      const url =
        `${BASE_URL}/api/${APIVersion.V1}` +
        `${API_ROUTES.LEARN.CHAT_STREAM(scenarioSessionId)}`;

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      let processedLength = 0;
      let buffer = '';
      let streamComplete = false;

      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'text/event-stream');

      xhr.onprogress = () => {
        if (streamComplete) {
          return;
        }

        const newData = xhr.responseText.substring(processedLength);
        processedLength = xhr.responseText.length;

        buffer += newData;
        const {events, remaining} = parseSSEBuffer(buffer);
        buffer = remaining;

        for (const event of events) {
          switch (event.type) {
            case SSEEventType.TOKEN:
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsg.id
                    ? {...msg, content: msg.content + event.content}
                    : msg,
                ),
              );
              break;

            case SSEEventType.DONE:
              streamComplete = true;
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsg.id
                    ? {...msg, isStreaming: false}
                    : msg,
                ),
              );
              setIsStreaming(false);
              xhrRef.current = null;
              return;

            case SSEEventType.ERROR:
              streamComplete = true;
              setMessages(prev =>
                prev.filter(msg => msg.id !== assistantMsg.id),
              );
              setError(event.error);
              setIsStreaming(false);
              xhrRef.current = null;
              return;
          }
        }
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (streamComplete) {
          return;
        }

        // Handle non-2xx status codes (errors returned as JSON before stream)
        if (xhr.status >= 400) {
          try {
            const errorBody = JSON.parse(xhr.responseText);
            const errorMessage = errorBody?.message || xhr.statusText;
            setError(
              Array.isArray(errorMessage)
                ? errorMessage.join(', ')
                : errorMessage,
            );
          } catch {
            setError(`Request failed with status ${xhr.status}`);
          }
          setMessages(prev => prev.filter(msg => msg.id !== assistantMsg.id));
          setIsStreaming(false);
          return;
        }

        // Process any remaining buffered data
        if (buffer.trim()) {
          const {events} = parseSSEBuffer(buffer + '\n\n');
          for (const event of events) {
            if (event.type === SSEEventType.TOKEN) {
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMsg.id
                    ? {...msg, content: msg.content + event.content}
                    : msg,
                ),
              );
            }
          }
        }

        // Mark stream as complete if not already done
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMsg.id ? {...msg, isStreaming: false} : msg,
          ),
        );
        setIsStreaming(false);
      };

      xhr.onerror = () => {
        xhrRef.current = null;
        if (streamComplete) {
          return;
        }
        setMessages(prev => prev.filter(msg => msg.id !== assistantMsg.id));
        setError('Network error. Please check your connection and try again.');
        setIsStreaming(false);
        logger.error('SSE stream: XHR network error');
      };

      xhr.ontimeout = () => {
        xhrRef.current = null;
        if (streamComplete) {
          return;
        }
        setMessages(prev => prev.filter(msg => msg.id !== assistantMsg.id));
        setError('Request timed out. Please try again.');
        setIsStreaming(false);
        logger.error('SSE stream: XHR timeout');
      };

      xhr.send(JSON.stringify({message: userMessageContent}));
    },
    [scenarioSessionId],
  );

  // ── Send Message ────────────────────────────────────────────

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !scenarioSessionId || isStreaming) {
        return;
      }

      setError(null);

      const userMsg = createUserMessage(trimmed);
      setMessages(prev => [...prev, userMsg]);

      streamFromSSE(trimmed);
    },
    [scenarioSessionId, isStreaming, streamFromSSE],
  );

  // ── Retry ───────────────────────────────────────────────────

  const retry = useCallback(() => {
    const lastUserMsg = [...messages]
      .reverse()
      .find(m => m.role === ChatMessageRole.USER);

    if (!lastUserMsg || !scenarioSessionId) {
      return;
    }

    setError(null);
    streamFromSSE(lastUserMsg.content);
  }, [messages, scenarioSessionId, streamFromSSE]);

  // ── Cleanup ─────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const isInterrupted =
    messages.length > 0 &&
    messages[messages.length - 1].role === ChatMessageRole.USER &&
    !isStreaming;

  return {
    messages,
    isStreaming,
    isLoading,
    error,
    isInterrupted,
    sendMessage,
    retry,
    cleanup,
  };
};
