import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CourseCopilotEvent } from "@types";

import { useAllySocket } from "./useAllySocket";

const NAMESPACE = "course-copilot";

const SocketEvents = {
  JOIN_SESSION: "joinSession",
  LEAVE_SESSION: "leaveSession",
  JOINED: "joined",
  EVENTS: "copilotEvents",
} as const;

interface UseCourseCopilotSocketOptions {
  sessionId: string | null;
  /** Called with each pushed batch, already de-duplicated by seq. */
  onEvents: (events: CourseCopilotEvent[]) => void;
  /** Called after a reconnect — anything pushed while the socket was down is gone for good. */
  onMissedWindow?: () => void;
  /** Keep the socket closed (e.g. an archived session has nothing left to stream). */
  enabled?: boolean;
}

/**
 * Live build and edit events over the `/course-copilot` socket namespace.
 *
 * The socket is a speed-up, not a dependency: a build can run on a different server instance
 * whose pushes never reach this connection, so the session page polls the detail endpoint every
 * 5 s while the status is BUILDING regardless. This hook's callers treat each pushed event as an
 * invalidation signal (refetch, debounced) rather than as state to apply — the polled detail is
 * the source of truth, which is what keeps the two paths from disagreeing.
 *
 * `connected` is the room-joined flag, exposed so a caller can say "live" in the UI and slow its
 * poll when pushing demonstrably works.
 */
export const useCourseCopilotSocket = ({
  sessionId,
  onEvents,
  onMissedWindow,
  enabled = true,
}: UseCourseCopilotSocketOptions) => {
  const [joined, setJoined] = useState(false);
  // Seq numbers are per session, so the set resets with the session id below. De-duplicating by
  // seq matters because a reconnect replays, and the page's own polling may already have fetched
  // the same rows — cheaper and far more reliable than making delivery exactly-once.
  const seenSeqRef = useRef<Set<number>>(new Set());

  // Held in refs so a fresh callback identity each render does not tear the socket down and
  // rebuild it — `handlers` must be referentially stable.
  const onEventsRef = useRef(onEvents);
  const onMissedWindowRef = useRef(onMissedWindow);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    onEventsRef.current = onEvents;
    onMissedWindowRef.current = onMissedWindow;
    sessionIdRef.current = sessionId;
  }, [onEvents, onMissedWindow, sessionId]);

  // Built once: `useAllySocket` requires `handlers` to be referentially stable, or it would tear
  // the socket down and rebuild it on every render. Everything that changes is read through refs.
  const handlers = useMemo<Record<string, (payload: unknown) => void>>(
    () => ({
      [SocketEvents.JOINED]: () => setJoined(true),
      [SocketEvents.EVENTS]: (raw: unknown) => {
        const payload = raw as { sessionId?: string; events?: CourseCopilotEvent[] } | null;
        if (!payload || !Array.isArray(payload.events) || !payload.events.length) return;
        // A batch for a session we have since navigated away from.
        if (payload.sessionId !== sessionIdRef.current) return;

        const fresh = payload.events.filter(
          event => typeof event?.seq === "number" && !seenSeqRef.current.has(event.seq),
        );
        if (!fresh.length) return;
        for (const event of fresh) seenSeqRef.current.add(event.seq);
        onEventsRef.current(fresh);
      },
    }),
    [],
  );

  // `emit` comes from the hook below, which needs these callbacks first; the ref breaks that
  // ordering cycle without reordering the hook.
  const emitRef = useRef<((event: string, payload?: unknown) => void) | null>(null);

  const joinRoom = useCallback(() => {
    if (sessionIdRef.current) {
      emitRef.current?.(SocketEvents.JOIN_SESSION, { sessionId: sessionIdRef.current });
    }
  }, []);

  const handleReconnected = useCallback(() => {
    // Re-joining is not enough: anything emitted while the socket was down was never queued
    // anywhere, so the caller has to refetch the gap.
    setJoined(false);
    joinRoom();
    onMissedWindowRef.current?.();
  }, [joinRoom]);

  const { emit } = useAllySocket({
    namespace: NAMESPACE,
    label: "course-copilot",
    handlers,
    enabled: Boolean(sessionId) && enabled,
    onConnected: joinRoom,
    onReconnected: handleReconnected,
  });

  useEffect(() => {
    emitRef.current = emit;
  }, [emit]);

  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    // Seq numbers are per session, so a different session starts from a clean slate.
    seenSeqRef.current = new Set();
    emit(SocketEvents.JOIN_SESSION, { sessionId });
    return () => {
      emit(SocketEvents.LEAVE_SESSION, { sessionId });
      setJoined(false);
    };
  }, [emit, enabled, sessionId]);

  /** Called by the page when it fetches events itself, to keep dedupe honest. */
  const markSeen = useCallback((events: CourseCopilotEvent[]) => {
    for (const event of events) seenSeqRef.current.add(event.seq);
  }, []);

  return { connected: joined, markSeen };
};
