import { useEffect, useRef } from "react";

import { ApiEndpoints, HttpMethod } from "@constants";
import { fetchWithReauth } from "@hooks/chatStream/fetchWithReauth";
import { readSse } from "@hooks/chatStream/sse";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/** Wait before reconnecting after the stream drops. */
const RECONNECT_MS = 2000;
/** Bursts of change events collapse into one re-read. */
const CHANGED_DEBOUNCE_MS = 400;

/** Copilot's progress line, from `narration {stage, text, errorCode?}` on /events. */
export interface Narration {
  stage: string;
  text: string;
  errorCode?: string;
  at?: string;
}

/** Events that mean the working copy or its sources changed. */
const CHANGES = new Set(["patched", "draft", "done", "brand", "step", "safety", "published"]);

/**
 * The draft's event stream (`/v1/bot-drafts/:id/events`) for the Create and Build screen: Copilot's
 * narration, crawl progress, and a debounced "something changed" so the form re-reads. Reconnects
 * on its own; the first event of each connection (`state`) is not treated as a change.
 */
export const useDraftEvents = (
  draftId: string | null,
  handlers: {
    onNarration?: (n: Narration) => void;
    onChanged?: () => void;
    onPage?: (pagesRead: number) => void;
  },
): void => {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!draftId) return undefined;
    let stopped = false;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let changed: ReturnType<typeof setTimeout> | undefined;
    const scheduleChanged = () => {
      clearTimeout(changed);
      changed = setTimeout(() => ref.current.onChanged?.(), CHANGED_DEBOUNCE_MS);
    };

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetchWithReauth(
          `${API_BASE_URL}/api${ApiEndpoints.BOT_DRAFTS.EVENTS(draftId)}`,
          undefined,
          controller.signal,
          HttpMethod.GET,
        );
        if (!response.ok || !response.body) throw new Error(String(response.status));
        await readSse(response.body, ({ type, data }) => {
          const event = (data ?? {}) as Record<string, unknown>;
          if (type === "narration") {
            ref.current.onNarration?.({
              stage: String(event.stage ?? ""),
              text: String(event.text ?? ""),
              errorCode: typeof event.errorCode === "string" ? event.errorCode : undefined,
              at: typeof event.at === "string" ? event.at : undefined,
            });
            // A crawl that finished or failed also changed the sources.
            if (event.stage === "read" || event.stage === "failed") scheduleChanged();
          } else if (type === "page") {
            ref.current.onPage?.(Number(event.n) || 0);
          } else if (CHANGES.has(type)) {
            scheduleChanged();
          }
        });
      } catch {
        // Dropped or refused: try again below.
      }
      if (!stopped) retry = setTimeout(() => void connect(), RECONNECT_MS);
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(changed);
      controller?.abort();
    };
  }, [draftId]);
};
