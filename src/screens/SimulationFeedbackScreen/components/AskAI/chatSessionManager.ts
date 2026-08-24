import {env} from '@/config/env';
import {
  API_METHODS,
  API_ROUTES,
  APIVersion,
  AsyncStorageKeys,
} from '@/constants';
import {getItem, setItem} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

import {
  AskAIChatMessage,
  ChatMessageRole,
  SSEEvent,
  SSEEventType,
} from './types';

// ── Session State ───────────────────────────────────────────────

export interface ChatSessionState {
  /** Committed messages (history + completed exchanges). Stable during streaming. */
  messages: AskAIChatMessage[];
  /** The in-progress assistant message, or null when not streaming. */
  streamingMessage: AskAIChatMessage | null;
  isStreaming: boolean;
  isLoading: boolean;
  error: string | null;
  isHistoryLoaded: boolean;
}

interface InternalSession extends ChatSessionState {
  xhr: XMLHttpRequest | null;
}

type Listener = () => void;

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

// ── Token Refresh ───────────────────────────────────────────────

let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Deduplicates concurrent calls so only one refresh request is in-flight.
 * Returns the new access token or null on failure.
 */
const refreshAccessToken = async (): Promise<string | null> => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = await getItem<string>(
        AsyncStorageKeys.REFRESH_TOKEN,
      );
      if (!refreshToken) {
        return null;
      }

      const url = `${env.API_BASE_URL}/api/${APIVersion.V1}${API_ROUTES.AUTH.REFRESH}`;

      const response = await fetch(url, {
        method: API_METHODS.POST,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({refreshToken}),
      });

      if (!response.ok) {
        return null;
      }

      const tokens: {accessToken: string; refreshToken: string} =
        await response.json();
      await setItem(AsyncStorageKeys.ACCESS_TOKEN, tokens.accessToken);
      await setItem(AsyncStorageKeys.REFRESH_TOKEN, tokens.refreshToken);
      return tokens.accessToken;
    } catch (err) {
      logger.error(`Token refresh failed: ${err}`);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

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

const parseSSEBuffer = (
  buffer: string,
): {events: SSEEvent[]; remaining: string} => {
  const events: SSEEvent[] = [];
  const parts = buffer.split('\n\n');
  const remaining = parts.pop() || '';

  for (const part of parts) {
    for (const line of part.split('\n')) {
      const event = parseSSELine(line.trim());
      if (event) {
        events.push(event);
      }
    }
  }

  return {events, remaining};
};

// ── Singleton Store ─────────────────────────────────────────────

const sessions = new Map<string, InternalSession>();
const listeners = new Map<string, Set<Listener>>();

/**
 * Snapshot cache: useSyncExternalStore requires referential equality
 * between getSnapshot() calls when nothing has changed.
 * We store the last emitted public snapshot per session and only
 * create a new object when the internal state actually mutates.
 */
const snapshotCache = new Map<string, ChatSessionState>();

const DEFAULT_STATE: ChatSessionState = {
  messages: [],
  streamingMessage: null,
  isStreaming: false,
  isLoading: false,
  error: null,
  isHistoryLoaded: false,
};

const getOrCreateSession = (sessionId: string): InternalSession => {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {...DEFAULT_STATE, xhr: null};
    sessions.set(sessionId, session);
  }
  return session;
};

/**
 * Build a public snapshot (without xhr) and cache it.
 * Returns the same object reference if nothing changed.
 */
const buildSnapshot = (sessionId: string): ChatSessionState => {
  const session = getOrCreateSession(sessionId);
  const cached = snapshotCache.get(sessionId);

  if (
    cached &&
    cached.messages === session.messages &&
    cached.streamingMessage === session.streamingMessage &&
    cached.isStreaming === session.isStreaming &&
    cached.isLoading === session.isLoading &&
    cached.error === session.error &&
    cached.isHistoryLoaded === session.isHistoryLoaded
  ) {
    return cached;
  }

  const snapshot: ChatSessionState = {
    messages: session.messages,
    streamingMessage: session.streamingMessage,
    isStreaming: session.isStreaming,
    isLoading: session.isLoading,
    error: session.error,
    isHistoryLoaded: session.isHistoryLoaded,
  };
  snapshotCache.set(sessionId, snapshot);
  return snapshot;
};

const notifyListeners = (sessionId: string) => {
  const set = listeners.get(sessionId);
  if (set) {
    set.forEach(cb => cb());
  }
};

// ── Public API ──────────────────────────────────────────────────

/** Get the current snapshot for useSyncExternalStore */
export const getSnapshot = (sessionId: string): ChatSessionState => {
  return buildSnapshot(sessionId);
};

/** Subscribe to changes for useSyncExternalStore. Returns unsubscribe. */
export const subscribe = (
  sessionId: string,
  callback: Listener,
): (() => void) => {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(callback);

  return () => {
    set!.delete(callback);
    if (set!.size === 0) {
      listeners.delete(sessionId);
    }
  };
};

/** Load chat history from the API (only once per session) */
export const loadHistory = async (sessionId: string) => {
  const session = getOrCreateSession(sessionId);
  if (session.isHistoryLoaded || session.isLoading) {
    return;
  }

  session.isLoading = true;
  notifyListeners(sessionId);

  try {
    const url =
      `${env.API_BASE_URL}/api/${APIVersion.V1}` +
      `${API_ROUTES.LEARN.CHAT_HISTORY(sessionId)}`;

    let token = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        token = newToken;
        response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
      }
    }

    if (response.ok) {
      const data: AskAIChatMessage[] = await response.json();
      session.messages = data;
    }
  } catch (err) {
    logger.error(`Failed to load chat history: ${err}`);
  } finally {
    session.isLoading = false;
    session.isHistoryLoaded = true;
    notifyListeners(sessionId);
  }
};

/** Send a user message and start SSE streaming */
export const sendMessage = (sessionId: string, text: string) => {
  const trimmed = text.trim();
  const session = getOrCreateSession(sessionId);

  if (!trimmed || session.isStreaming) {
    return;
  }

  session.error = null;

  const userMsg = createUserMessage(trimmed);
  session.messages = [...session.messages, userMsg];
  notifyListeners(sessionId);

  startStream(sessionId, trimmed);
};

/** Retry the last user message */
export const retry = (sessionId: string) => {
  const session = getOrCreateSession(sessionId);
  const lastUserMsg = [...session.messages]
    .reverse()
    .find(m => m.role === ChatMessageRole.USER);

  if (!lastUserMsg || session.isStreaming) {
    return;
  }

  session.error = null;
  notifyListeners(sessionId);

  startStream(sessionId, lastUserMsg.content);
};

/** Abort an in-flight stream for a session */
export const cleanup = (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (session?.xhr) {
    session.xhr.abort();
    session.xhr = null;
    session.streamingMessage = null;
    session.isStreaming = false;
    notifyListeners(sessionId);
  }
};

/** Remove all state for a session from memory */
export const destroySession = (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (session?.xhr) {
    session.xhr.abort();
  }
  sessions.delete(sessionId);
  listeners.delete(sessionId);
  snapshotCache.delete(sessionId);
};

/**
 * On a mid-stream interruption (network drop, timeout), move whatever the
 * assistant had already streamed from `streamingMessage` into the committed
 * `messages` list, instead of discarding it. A partial answer plus an
 * honest "connection lost" error is strictly more useful than silently
 * replacing a real (if incomplete) reply with nothing but an error banner.
 * No-op when nothing had streamed in yet (empty content).
 */
const commitPartialStreamingMessage = (session: InternalSession): void => {
  if (session.streamingMessage && session.streamingMessage.content) {
    session.messages = [
      ...session.messages,
      {...session.streamingMessage, isStreaming: false},
    ];
  }
  session.streamingMessage = null;
};

// ── XHR Stream (internal) ───────────────────────────────────────

const startStream = async (
  sessionId: string,
  userMessageContent: string,
  isRetryAfterRefresh = false,
) => {
  const session = getOrCreateSession(sessionId);

  session.streamingMessage = createAssistantMessage();
  session.isStreaming = true;
  session.error = null;
  notifyListeners(sessionId);

  let token = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
  if (!token) {
    session.streamingMessage = null;
    session.error = 'No access token';
    session.isStreaming = false;
    notifyListeners(sessionId);
    return;
  }

  const url =
    `${env.API_BASE_URL}/api/${APIVersion.V1}` +
    `${API_ROUTES.LEARN.CHAT_STREAM(sessionId)}`;

  const xhr = new XMLHttpRequest();
  session.xhr = xhr;

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
        case SSEEventType.START:
          break;

        case SSEEventType.TOKEN:
          if (session.streamingMessage) {
            session.streamingMessage = {
              ...session.streamingMessage,
              content: session.streamingMessage.content + event.content,
            };
            notifyListeners(sessionId);
          }
          break;

        case SSEEventType.CITATIONS:
          if (session.streamingMessage) {
            const existing = session.streamingMessage.citations || [];
            session.streamingMessage = {
              ...session.streamingMessage,
              citations: [...existing, ...event.citations],
            };
            notifyListeners(sessionId);
          }
          break;

        case SSEEventType.DONE: {
          streamComplete = true;
          const finalMsg = {
            ...session.streamingMessage!,
            content: event.content || session.streamingMessage!.content,
            citations: event.citations || session.streamingMessage?.citations,
            isStreaming: false,
          };
          session.messages = [...session.messages, finalMsg];
          session.streamingMessage = null;
          session.isStreaming = false;
          session.xhr = null;
          notifyListeners(sessionId);
          return;
        }

        case SSEEventType.ERROR:
          streamComplete = true;
          session.streamingMessage = null;
          session.error = event.error;
          session.isStreaming = false;
          session.xhr = null;
          notifyListeners(sessionId);
          return;
      }
    }
  };

  xhr.onload = async () => {
    session.xhr = null;
    if (streamComplete) {
      return;
    }

    if (xhr.status === 401 && !isRetryAfterRefresh) {
      session.streamingMessage = null;
      session.isStreaming = false;
      notifyListeners(sessionId);

      const newToken = await refreshAccessToken();
      if (newToken) {
        startStream(sessionId, userMessageContent, true);
        return;
      }

      session.error = 'Session expired. Please log in again.';
      notifyListeners(sessionId);
      return;
    }

    if (xhr.status >= 400) {
      try {
        const errorBody = JSON.parse(xhr.responseText);
        const errorMessage = errorBody?.message || xhr.statusText;
        session.error = Array.isArray(errorMessage)
          ? errorMessage.join(', ')
          : errorMessage;
      } catch {
        session.error = `Request failed with status ${xhr.status}`;
      }
      session.streamingMessage = null;
      session.isStreaming = false;
      notifyListeners(sessionId);
      return;
    }

    // Flush remaining buffer
    if (buffer.trim() && session.streamingMessage) {
      const {events} = parseSSEBuffer(buffer + '\n\n');
      for (const event of events) {
        if (event.type === SSEEventType.TOKEN) {
          session.streamingMessage = {
            ...session.streamingMessage,
            content: session.streamingMessage.content + event.content,
          };
        } else if (event.type === SSEEventType.CITATIONS) {
          const existing = session.streamingMessage.citations || [];
          session.streamingMessage = {
            ...session.streamingMessage,
            citations: [...existing, ...event.citations],
          };
        } else if (event.type === SSEEventType.DONE) {
          session.streamingMessage = {
            ...session.streamingMessage,
            content: event.content || session.streamingMessage.content,
            citations: event.citations || session.streamingMessage.citations,
          };
        }
      }
    }

    // Commit the streaming message
    if (session.streamingMessage) {
      const finalMsg = {...session.streamingMessage, isStreaming: false};
      session.messages = [...session.messages, finalMsg];
    }
    session.streamingMessage = null;
    session.isStreaming = false;
    notifyListeners(sessionId);
  };

  xhr.onerror = () => {
    session.xhr = null;
    if (streamComplete) {
      return;
    }
    // A network drop mid-stream still means the assistant already streamed
    // some real content into `streamingMessage` (via onprogress TOKEN
    // events). Losing that entirely and showing only an error would throw
    // away a genuine partial answer — commit what came in before the drop,
    // same as a normal completion, and surface the error alongside it
    // rather than in its place.
    commitPartialStreamingMessage(session);
    session.error =
      'Network error. Please check your connection and try again.';
    session.isStreaming = false;
    notifyListeners(sessionId);
    logger.error('SSE stream: XHR network error');
  };

  xhr.ontimeout = () => {
    session.xhr = null;
    if (streamComplete) {
      return;
    }
    // Same reasoning as onerror above: a timeout is still a mid-stream
    // interruption, not a signal that nothing was received.
    commitPartialStreamingMessage(session);
    session.error = 'Request timed out. Please try again.';
    session.isStreaming = false;
    notifyListeners(sessionId);
    logger.error('SSE stream: XHR timeout');
  };

  xhr.send(JSON.stringify({message: userMessageContent}));
};
