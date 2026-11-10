import { RefObject, useCallback, useEffect, useRef } from "react";

import {
  DebriefEventKind,
  useMarkDebriefOpenedMutation,
  useMarkDebriefReadMutation,
  useReportDebriefEventMutation,
} from "@api";

/** v9 FR-65: the debrief must have been open this long. */
export const READ_MIN_OPEN_MS = 30_000;

/**
 * DEBRIEF_READ XP: once the end of the last Work-on-this card has been on
 * screen and the debrief has been open for 30 seconds, tell the server — at
 * most once per mount; the server pays at most once per session anyway.
 * Opening and immediately closing earns nothing.
 */
export const useReadToTheEnd = (sessionId: string, endRef: RefObject<Element>, enabled = true) => {
  const [markRead] = useMarkDebriefReadMutation();
  const sent = useRef(false);

  useEffect(() => {
    const node = endRef.current;
    // Only the learner reading their own debrief earns it; never a supervisor.
    if (!enabled || !node || typeof IntersectionObserver === "undefined") return undefined;
    let seen = false;
    let longEnough = false;
    const maybeSend = () => {
      if (seen && longEnough && !sent.current) {
        sent.current = true;
        void markRead(sessionId);
      }
    };
    const timer = setTimeout(() => {
      longEnough = true;
      maybeSend();
    }, READ_MIN_OPEN_MS);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        seen = true;
        maybeSend();
      }
    });
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [endRef, markRead, sessionId, enabled]);
};

/** v9 FR-31: "opened" is the ready debrief in the foreground for 2 s. */
export const OPENED_AFTER_MS = 2000;

/** Tells the server, once, that the learner opened their debrief. */
export const useMarkOpened = (sessionId: string, enabled: boolean) => {
  const [markOpened] = useMarkDebriefOpenedMutation();
  const sent = useRef(false);
  useEffect(() => {
    if (!enabled || sent.current) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        sent.current = true;
        void markOpened(sessionId);
      }, OPENED_AFTER_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [enabled, markOpened, sessionId]);
};

/**
 * v9 §3.3 experience metrics: reports something the learner did that only
 * the app can see, at most once per kind per mount (the server keeps one per
 * session anyway). Fire-and-forget: a failure is never shown and never
 * blocks reading. A supervisor's view reports nothing.
 */
export const useDebriefEvent = (sessionId: string, enabled: boolean) => {
  const [report] = useReportDebriefEventMutation();
  const sent = useRef(new Set<DebriefEventKind>());
  return useCallback(
    (kind: DebriefEventKind) => {
      if (!enabled || sent.current.has(kind)) return;
      sent.current.add(kind);
      void report({ sessionId, kind })
        .unwrap()
        .catch(() => undefined);
    },
    [enabled, report, sessionId],
  );
};

/** Calls `onSeen` once, the first time `ref` scrolls into view. */
export const useSeenOnce = (ref: RefObject<Element>, onSeen: () => void, enabled = true) => {
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        observer.disconnect();
        onSeen();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, onSeen, enabled]);
};

/**
 * v9 §3.3 "abandoned before ready": the working screen was shown (`waited`),
 * and the learner left it — closed the tab, hid it, or navigated away —
 * while the debrief was still being written (`left_before_ready`).
 */
export const useWaitingEvents = (
  working: boolean,
  send: (kind: DebriefEventKind) => void,
  enabled: boolean,
) => {
  const stillWorking = useRef(working);
  stillWorking.current = working;
  useEffect(() => {
    if (!enabled || !working) return undefined;
    send("waited");
    const left = () => {
      if (stillWorking.current) send("left_before_ready");
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") left();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", left);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", left);
      // Unmounted while still working: the learner navigated away.
      left();
    };
  }, [enabled, working, send]);
};
