import {env} from '@/config/env';
import {API_ROUTES, APIVersion, AsyncStorageKeys} from '@/constants';
import {getItem} from '@/utils/asyncStorage';
import {logger} from '@/utils/logger';

import {
  AskAIChatMessage,
  ChatMessageRole,
  SSEEvent,
  SSEEventType,
} from './types';

// ── Session State ───────────────────────────────────────────────

export interface ChatSessionState {
  messages: AskAIChatMessage[];
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
    cached.isStreaming === session.isStreaming &&
    cached.isLoading === session.isLoading &&
    cached.error === session.error &&
    cached.isHistoryLoaded === session.isHistoryLoaded
  ) {
    return cached;
  }

  const snapshot: ChatSessionState = {
    messages: session.messages,
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
  const token = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
  if (session.isHistoryLoaded || session.isLoading) {
    return;
  }

  session.isLoading = true;
  notifyListeners(sessionId);

  try {
    const url =
      `${env.API_BASE_URL}/api/${APIVersion.V1}` +
      `${API_ROUTES.LEARN.CHAT_HISTORY(sessionId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

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
    session.isStreaming = false;
    notifyListeners(sessionId);
  }
};

// ── XHR Stream (internal) ───────────────────────────────────────

const startStream = async (sessionId: string, userMessageContent: string) => {
  const session = getOrCreateSession(sessionId);

  const assistantMsg = createAssistantMessage();
  session.messages = [...session.messages, assistantMsg];
  session.isStreaming = true;
  session.error = null;
  notifyListeners(sessionId);

  const token = await getItem<string>(AsyncStorageKeys.ACCESS_TOKEN);
  if (!token) {
    session.messages = session.messages.filter(m => m.id !== assistantMsg.id);
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
        case SSEEventType.TOKEN:
          session.messages = session.messages.map(msg =>
            msg.id === assistantMsg.id
              ? {...msg, content: msg.content + event.content}
              : msg,
          );
          notifyListeners(sessionId);
          break;

        case SSEEventType.DONE:
          streamComplete = true;
          session.messages = session.messages.map(msg =>
            msg.id === assistantMsg.id ? {...msg, isStreaming: false} : msg,
          );
          session.isStreaming = false;
          session.xhr = null;
          notifyListeners(sessionId);
          return;

        case SSEEventType.ERROR:
          streamComplete = true;
          session.messages = session.messages.filter(
            m => m.id !== assistantMsg.id,
          );
          session.error = event.error;
          session.isStreaming = false;
          session.xhr = null;
          notifyListeners(sessionId);
          return;
      }
    }
  };

  xhr.onload = () => {
    session.xhr = null;
    if (streamComplete) {
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
      session.messages = session.messages.filter(m => m.id !== assistantMsg.id);
      session.isStreaming = false;
      notifyListeners(sessionId);
      return;
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const {events} = parseSSEBuffer(buffer + '\n\n');
      for (const event of events) {
        if (event.type === SSEEventType.TOKEN) {
          session.messages = session.messages.map(msg =>
            msg.id === assistantMsg.id
              ? {...msg, content: msg.content + event.content}
              : msg,
          );
        }
      }
    }

    session.messages = session.messages.map(msg =>
      msg.id === assistantMsg.id ? {...msg, isStreaming: false} : msg,
    );
    session.isStreaming = false;
    notifyListeners(sessionId);
  };

  xhr.onerror = () => {
    session.xhr = null;
    if (streamComplete) {
      return;
    }
    session.messages = session.messages.filter(m => m.id !== assistantMsg.id);
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
    session.messages = session.messages.filter(m => m.id !== assistantMsg.id);
    session.error = 'Request timed out. Please try again.';
    session.isStreaming = false;
    notifyListeners(sessionId);
    logger.error('SSE stream: XHR timeout');
  };

  xhr.send(JSON.stringify({message: userMessageContent}));
};
