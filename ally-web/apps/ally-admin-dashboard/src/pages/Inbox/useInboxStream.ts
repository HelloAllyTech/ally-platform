import { useEffect, useRef } from "react";

import { useDispatch } from "react-redux";

import { inboxApi, type InboxCounts } from "@api";
import { ApiEndpoints, HttpMethod, TAG_TYPES } from "@constants";
import { fetchWithReauth } from "@hooks/chatStream/fetchWithReauth";
import { readSse } from "@hooks/chatStream/sse";

import { backoff } from "./useInboxStream.backoff";

import type { AppDispatch } from "../../store";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export { backoff, BACKOFF_MS } from "./useInboxStream.backoff";

export interface InboxStreamEvent {
  type: "hello" | "message" | "state" | "safety" | "read";
  chatbotId?: string;
  conversationId?: string;
  state?: string;
  counts?: InboxCounts;
}

/**
 * The inbox's live stream (chunk 11a): ally-be's `GET v1/inbox/events`, over `fetch` so the admin
 * token goes with it (and is refreshed once on 401). Each event refreshes the inbox's cached lists;
 * `hello` (the counts) comes first on every connect, so a reconnect redraws and nothing missed is
 * lost. Reconnects with backoff while the page is open.
 */
export function useInboxStream(onEvent: (event: InboxStreamEvent) => void): void {
  const dispatch = useDispatch<AppDispatch>();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    // Several events in a burst refresh once.
    const refreshSoon = () => {
      clearTimeout(refresh);
      refresh = setTimeout(() => dispatch(inboxApi.util.invalidateTags([TAG_TYPES.INBOX])), 300);
    };

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetchWithReauth(
          `${API_BASE_URL}/api${ApiEndpoints.INBOX.EVENTS}`,
          undefined,
          controller.signal,
          HttpMethod.GET,
        );
        if (!response.ok || !response.body) throw new Error(String(response.status));
        attempt = 0;
        await readSse(response.body, ({ type, data }) => {
          const event = { ...(data as object), type } as InboxStreamEvent;
          if (type === "hello") event.counts = data as InboxCounts;
          refreshSoon();
          handler.current(event);
        });
      } catch {
        // Dropped or refused: try again below.
      }
      if (!stopped) retry = setTimeout(() => void connect(), backoff(attempt++));
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(refresh);
      controller?.abort();
    };
  }, [dispatch]);
}
