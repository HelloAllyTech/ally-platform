import { useEffect, useRef } from "react";

import { readSseStream, reconnectDelay } from "@utils/sseStream";

import { openGuideStream } from "./guideStreamFetch";
import { GUIDE_EVENT_TYPES, type GuideEvent } from "../contract/wire";
import { errorCodeOf } from "../state/failureStates";

/** The server pings every 15 s; 45 s of silence means the stream is dead (plan §7.10). */
export const STREAM_DEAD_AFTER_MS = 45_000;
/** A hidden tab lets go of its stream after this long and resumes on focus (plan §11 E-3). */
export const HIDDEN_RELEASE_AFTER_MS = 45_000;

export type StreamStatus = "connecting" | "open" | "lost";
export type StreamFatal = "disabled" | "forbidden" | "not_found" | "visitor_invalid";

export interface UseGuideEventStreamOptions {
  threadId: string | null;
  enabled: boolean;
  /** Read at every (re)connect: the last durable seq the feed has applied. */
  getLastSeq: () => number;
  onEvent: (event: GuideEvent) => void;
  onStatus: (status: StreamStatus) => void;
  /** The server refused the stream for good: leave the guided journey. */
  onFatal: (reason: StreamFatal) => void;
  /** An anonymous visitor's token: the public stream, reconnected when it changes. */
  visitorToken?: string | null;
  /** For tests. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  random?: () => number;
}

const KNOWN_TYPES = new Set<string>(GUIDE_EVENT_TYPES);

/** Parses one frame's JSON; unknown or malformed events are dropped (forward compatible). */
export const parseGuideEvent = (data: string): GuideEvent | null => {
  try {
    const event = JSON.parse(data) as GuideEvent;
    if (!event || typeof event !== "object" || !KNOWN_TYPES.has(event.type)) return null;
    return event;
  } catch {
    return null;
  }
};

class FatalStreamError extends Error {
  constructor(readonly reason: StreamFatal) {
    super(reason);
  }
}

const fatalFor = async (response: Response): Promise<StreamFatal | null> => {
  if (response.status === 404) return "not_found";
  if (response.status !== 403 && response.status !== 401) return null;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON refusal is still a refusal.
  }
  const code = errorCodeOf({ data: body });
  // Only a visitor's stream answers 401 here (a learner's refreshes first).
  if (response.status === 401) return code === "GUIDE_VISITOR_INVALID" ? "visitor_invalid" : null;
  return code === "GUIDE_DISABLED" ? "disabled" : "forbidden";
};

/**
 * Keeps the thread's event stream open (plan §9.2, §7.10):
 * - `fetch`-based so the JWT travels in a header; a 401 refreshes and retries;
 * - resumes with `Last-Event-ID` = the feed's last durable seq, so nothing is
 *   lost or duplicated across a drop;
 * - treats 45 s without a byte (pings arrive every 15 s) as a dead stream;
 * - reconnects with 1–15 s jittered backoff, at once when the browser comes
 *   back online or the tab becomes visible, and not at all while offline;
 * - lets go of the stream after 45 s in a hidden tab.
 */
export const useGuideEventStream = ({
  threadId,
  enabled,
  getLastSeq,
  onEvent,
  onStatus,
  onFatal,
  visitorToken,
  fetchImpl,
  random,
}: UseGuideEventStreamOptions): void => {
  // Callbacks change identity every render; the connection must not.
  const callbacks = useRef({ getLastSeq, onEvent, onStatus, onFatal, fetchImpl, random });
  callbacks.current = { getLastSeq, onEvent, onStatus, onFatal, fetchImpl, random };

  useEffect(() => {
    if (!enabled || !threadId) return undefined;

    let stopped = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let deadTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let releasedWhileHidden = false;

    const clearDead = () => {
      if (deadTimer) clearTimeout(deadTimer);
      deadTimer = null;
    };
    const armDead = () => {
      clearDead();
      deadTimer = setTimeout(() => controller?.abort(), STREAM_DEAD_AFTER_MS);
    };
    const clearRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
    const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

    const scheduleRetry = () => {
      clearRetry();
      if (stopped || releasedWhileHidden || isOffline()) return;
      attempt += 1;
      retryTimer = setTimeout(connect, reconnectDelay(attempt, callbacks.current.random));
    };

    async function connect() {
      clearRetry();
      if (stopped || releasedWhileHidden) return;
      if (isOffline()) {
        callbacks.current.onStatus("lost");
        return;
      }
      controller?.abort();
      const current = new AbortController();
      controller = current;
      callbacks.current.onStatus("connecting");
      armDead();
      try {
        const response = await openGuideStream({
          threadId: threadId as string,
          afterSeq: callbacks.current.getLastSeq(),
          signal: current.signal,
          fetchImpl: callbacks.current.fetchImpl,
          visitorToken,
        });
        if (!response.ok || !response.body) {
          const fatal = await fatalFor(response);
          if (fatal) throw new FatalStreamError(fatal);
          throw new Error(`stream ${response.status}`);
        }
        await readSseStream(response.body, frame => {
          if (current !== controller) return;
          armDead();
          const event = parseGuideEvent(frame.data);
          if (!event) return;
          if (event.type === "hello") {
            attempt = 0;
            callbacks.current.onStatus("open");
          }
          callbacks.current.onEvent(event);
        });
        // The server closed the stream (a deploy, a load balancer); reconnect.
        throw new Error("stream closed");
      } catch (error) {
        if (current !== controller) return;
        clearDead();
        if (stopped) return;
        if (error instanceof FatalStreamError) {
          stopped = true;
          callbacks.current.onFatal(error.reason);
          return;
        }
        callbacks.current.onStatus("lost");
        scheduleRetry();
      }
    }

    const reconnectNow = () => {
      if (stopped) return;
      attempt = 0;
      void connect();
    };

    const onOnline = () => reconnectNow();
    const onOffline = () => {
      controller?.abort();
      controller = null;
      clearDead();
      clearRetry();
      callbacks.current.onStatus("lost");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer = setTimeout(() => {
          releasedWhileHidden = true;
          controller?.abort();
          controller = null;
          clearDead();
          clearRetry();
        }, HIDDEN_RELEASE_AFTER_MS);
        return;
      }
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = null;
      if (releasedWhileHidden) {
        releasedWhileHidden = false;
        reconnectNow();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    void connect();

    return () => {
      stopped = true;
      controller?.abort();
      controller = null;
      clearDead();
      clearRetry();
      if (hiddenTimer) clearTimeout(hiddenTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [threadId, enabled, visitorToken]);
};
