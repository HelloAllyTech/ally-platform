import { useEffect, useState, useSyncExternalStore } from "react";

import type { PresenceEntry } from "../hooks/useRoadmapRealtime";

/**
 * The open idea's presence, for the question cards and the comment box, without threading it
 * through every component between the page and the card. `useRoadmapRealtime` publishes here
 * (one page runs it at a time); with nothing published, nothing shows and typing announces nothing.
 */
export interface RoadmapPresenceValue {
  presence: PresenceEntry[];
  announceTyping: (questionId?: string) => void;
}

const EMPTY: RoadmapPresenceValue = { presence: [], announceTyping: () => undefined };
let current: RoadmapPresenceValue = EMPTY;
const listeners = new Set<() => void>();

export const publishRoadmapPresence = (value: RoadmapPresenceValue | null): void => {
  current = value ?? EMPTY;
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useRoadmapPresence = (): RoadmapPresenceValue =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );

/** A typing beat counts for this long; the server keeps no state, so the client decides. */
export const TYPING_SHOW_MS = 6_000;

/** Who is typing in `questionId`'s box right now (the comment box when undefined). */
export const useTypingIn = (questionId?: string): string[] => {
  const { presence } = useRoadmapPresence();
  const [now, setNow] = useState(() => Date.now());
  const typing = (Array.isArray(presence) ? presence : []).filter(
    p => p.kind === "typing" && (p.questionId ?? undefined) === questionId,
  );
  const live = typing.filter(p => now - p.at < TYPING_SHOW_MS);
  const hasTyping = typing.length > 0;
  useEffect(() => {
    setNow(Date.now());
    if (!hasTyping) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [hasTyping, presence]);
  return Array.from(new Set(live.map(p => p.name)));
};
