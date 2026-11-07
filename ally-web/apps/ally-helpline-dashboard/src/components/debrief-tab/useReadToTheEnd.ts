import { RefObject, useEffect, useRef } from "react";

import { useMarkDebriefOpenedMutation, useMarkDebriefReadMutation } from "@api";

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
