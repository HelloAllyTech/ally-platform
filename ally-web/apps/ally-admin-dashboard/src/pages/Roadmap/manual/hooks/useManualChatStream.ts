import { useCallback, useEffect, useReducer, useRef } from "react";

import { ApiEndpoints, en } from "@constants";
import type { ManualChatContext, ManualConversation } from "@types";
import { logger } from "@utils";

import { fetchWithReauth } from "../../../../hooks/chatStream/fetchWithReauth";
import { readSse } from "../../../../hooks/chatStream/sse";
import {
  ManualChatServerEvent,
  ManualChatState,
  applyManualChatEvent,
  initialManualChatState,
  isManualChatServerEvent,
} from "../utils/chatState";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/** The contract's limits: `message` ≤ 4000, `selection` ≤ 1500. */
export const MANUAL_MESSAGE_MAX = 4000;
export const MANUAL_SELECTION_MAX = 1500;

let counter = 0;
const localId = () => {
  counter += 1;
  return `local-${Date.now().toString(36)}-${counter}`;
};

export interface UseManualChatStreamOptions {
  /** Called for every server event, after the state has it: the shell refreshes an edited page. */
  onEvent?: (event: ManualChatServerEvent) => void;
}

export interface ManualChatStream {
  state: ManualChatState;
  send: (message: string, context?: ManualChatContext) => Promise<void>;
  stop: () => void;
  load: (conversation: ManualConversation) => void;
  reset: () => void;
  updateDraft: (id: string, patch: { savedCode?: string | null; discarded?: boolean }) => void;
}

/**
 * One manual chat over SSE (`POST /v1/product-manual/chat/stream`), modelled on the Roadmap
 * copilot stream: the admin's bearer with one refresh-and-retry, `readSse` for the frames, and a
 * pure reducer (`applyManualChatEvent`) for everything that changes state.
 *
 * One stream at a time per conversation: the server answers 409 while another is running, which
 * is said in words. Stop aborts the request; what arrived so far stays, marked as stopped.
 */
export const useManualChatStream = (options: UseManualChatStreamOptions = {}): ManualChatStream => {
  const [state, dispatch] = useReducer(applyManualChatEvent, initialManualChatState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  const copy = en.productManual.chat;

  // Abort on a real unmount, deferred a tick so React's development double-mount doesn't kill a
  // turn that just started (the same guard as the Roadmap copilot stream).
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const inFlight = abortRef.current;
      setTimeout(() => {
        if (!mountedRef.current) inFlight?.abort();
      }, 0);
    };
  }, []);

  const send = useCallback(
    async (message: string, context?: ManualChatContext) => {
      const text = message.trim();
      if (!text || stateRef.current.streaming) return;
      const trimmedContext = context
        ? {
            ...(context.pageSlug ? { pageSlug: context.pageSlug } : {}),
            ...(context.selection?.trim()
              ? { selection: context.selection.trim().slice(0, MANUAL_SELECTION_MAX) }
              : {}),
          }
        : undefined;
      const hasContext = !!trimmedContext && Object.keys(trimmedContext).length > 0;
      dispatch({
        type: "local_send",
        data: {
          localId: localId(),
          message: text,
          ...(hasContext ? { context: trimmedContext } : {}),
        },
      });
      if (text.length > MANUAL_MESSAGE_MAX) {
        dispatch({ type: "local_fail", data: { message: copy.tooLong(MANUAL_MESSAGE_MAX) } });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let finished = false;
      try {
        const conversationId = stateRef.current.conversationId;
        const response = await fetchWithReauth(
          `${API_BASE_URL}/api${ApiEndpoints.PRODUCT_MANUAL.CHAT_STREAM}`,
          {
            ...(conversationId ? { conversationId } : {}),
            message: text,
            ...(hasContext ? { context: trimmedContext } : {}),
          },
          controller.signal,
        );
        if (!response.ok || !response.body) {
          const failure =
            response.status === 409
              ? copy.busy
              : response.status === 403
                ? copy.forbidden
                : copy.failed;
          dispatch({ type: "local_fail", data: { message: failure } });
          finished = true;
          return;
        }
        await readSse(
          response.body,
          raw => {
            if (!isManualChatServerEvent(raw)) return false;
            dispatch(raw);
            onEventRef.current?.(raw);
            if (raw.type === "done" || raw.type === "error") {
              finished = true;
              return true;
            }
            return false;
          },
          eventName => logger.warn(`[Product manual] Dropping malformed SSE frame "${eventName}"`),
        );
        if (!finished) {
          dispatch({ type: "local_fail", data: { message: copy.dropped } });
          finished = true;
        }
      } catch (error) {
        if (finished) return;
        if ((error as { name?: string } | null)?.name === "AbortError") {
          dispatch({ type: "local_abort", data: { message: copy.stopped } });
        } else {
          dispatch({ type: "local_fail", data: { message: copy.failed } });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [copy],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const load = useCallback((conversation: ManualConversation) => {
    abortRef.current?.abort();
    dispatch({ type: "local_load", data: conversation });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "local_reset" });
  }, []);

  const updateDraft = useCallback(
    (id: string, patch: { savedCode?: string | null; discarded?: boolean }) =>
      dispatch({ type: "local_draft", data: { id, ...patch } }),
    [],
  );

  return { state, send, stop, load, reset, updateDraft };
};
