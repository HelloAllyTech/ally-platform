import {useCallback, useEffect, useSyncExternalStore} from 'react';

import {
  ChatSessionState,
  cleanup,
  getSnapshot,
  loadHistory,
  retry,
  sendMessage,
  subscribe,
} from './chatSessionManager';
import {ChatMessageRole, UseAskAIChatOptions} from './types';

const SCENARIO_SESSION_ID = 'b14fae23-e0a9-44a7-a911-edf14498fc53';

/**
 * Thin React wrapper around ChatSessionManager.
 *
 * All chat state lives in the module-level singleton store so it persists
 * across component mounts/unmounts. This hook just subscribes to changes
 * via useSyncExternalStore and exposes action functions.
 */
export const useAskAIChat = ({
  scenarioSessionId = SCENARIO_SESSION_ID,
}: UseAskAIChatOptions) => {
  const sessionId = scenarioSessionId || '';

  const state: ChatSessionState = useSyncExternalStore(
    cb => subscribe(sessionId, cb),
    () => getSnapshot(sessionId),
  );

  // Load history once when the session is first accessed
  useEffect(() => {
    if (sessionId && !state.isHistoryLoaded) {
      loadHistory(sessionId);
    }
  }, [sessionId, state.isHistoryLoaded]);

  const send = useCallback(
    (text: string) => sendMessage(sessionId, text),
    [sessionId],
  );

  const retryFn = useCallback(() => retry(sessionId), [sessionId]);

  const cleanupFn = useCallback(() => cleanup(sessionId), [sessionId]);

  const isInterrupted =
    state.messages.length > 0 &&
    state.messages[state.messages.length - 1].role === ChatMessageRole.USER &&
    !state.isStreaming;

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    isLoading: state.isLoading,
    error: state.error,
    isInterrupted,
    sendMessage: send,
    retry: retryFn,
    cleanup: cleanupFn,
  };
};
