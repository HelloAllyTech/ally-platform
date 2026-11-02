import { RefObject, useEffect, useRef } from "react";

import { useMarkDebriefReadMutation } from "@api";

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
