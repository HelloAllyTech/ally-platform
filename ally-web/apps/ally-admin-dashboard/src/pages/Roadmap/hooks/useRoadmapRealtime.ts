import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { baseAPI } from "@api";
import { TAG_TYPES } from "@constants";
import { useAllySocket } from "@hooks";
import { store } from "@store";
import type { RoadmapItemChangedEvent, RoadmapPresenceEvent } from "@types";

import { publishRoadmapPresence } from "../session/presenceContext";

/** Wire names on the existing roadmap namespace (P2 contract). */
export const ROADMAP_V2_SOCKET = {
  /** The board room, as today; item changes fan out to it. */
  JOIN_BOARD: "JOIN_BOARD",
  JOIN_ITEM: "roadmap:join-item",
  LEAVE_ITEM: "roadmap:leave-item",
  ITEM_CHANGED: "roadmap:item-changed",
  PRESENCE: "roadmap:presence",
} as const;

/** A presence beat older than this is dropped: viewers leave without saying so. */
export const PRESENCE_TTL_MS = 30_000;
const COALESCE_MS = 250;
/** The contract asks for a re-send about every 20 s; a little under keeps us inside the 30 s TTL. */
const VIEWING_BEAT_MS = 18_000;
/** A typing beat at most this often; a presence shows for a few seconds after the last one. */
const TYPING_BEAT_MS = 4_000;

export interface PresenceEntry {
  userId: number;
  name: string;
  kind: "viewing" | "typing";
  questionId?: string;
  at: number;
}

/** Pure: fold a presence event into the current list, dropping stale and own entries. */
export const applyPresence = (
  current: PresenceEntry[],
  event: RoadmapPresenceEvent,
  now: number,
  selfId?: number,
): PresenceEntry[] => {
  if (selfId !== undefined && event.userId === selfId) return current;
  const fresh = current.filter(
    p => now - p.at < PRESENCE_TTL_MS && !(p.userId === event.userId && p.kind === event.kind),
  );
  return [
    ...fresh,
    {
      userId: event.userId,
      name: event.name,
      kind: event.kind,
      questionId: event.questionId,
      at: now,
    },
  ];
};

interface Options {
  enabled: boolean;
  currentUserId?: number;
  /** The idea open on screen: presence is listened for and announced for it alone. */
  openCode?: string | null;
}

/**
 * Live updates for Roadmap v2 (§4.12, §5.7b) on the existing roadmap socket. An item change
 * invalidates that idea and the lists, coalesced, so a burst refetches once; the list itself holds
 * its order while it is being read (see QueueList). Presence is ephemeral and never stored.
 */
export const useRoadmapRealtime = ({ enabled, currentUserId, openCode }: Options) => {
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const openRef = useRef(openCode ?? null);
  openRef.current = openCode ?? null;

  const flush = useCallback(() => {
    timer.current = null;
    const codes = [...pending.current];
    pending.current.clear();
    store.dispatch(
      baseAPI.util.invalidateTags([
        { type: TAG_TYPES.ROADMAP_V2_ITEMS, id: "LIST" },
        ...codes.map(code => ({ type: TAG_TYPES.ROADMAP_V2_ITEMS, id: code.toUpperCase() })),
      ]),
    );
  }, []);

  const handlers = useMemo(
    () => ({
      [ROADMAP_V2_SOCKET.ITEM_CHANGED]: (payload: unknown) => {
        const event = payload as RoadmapItemChangedEvent;
        if (!event?.code) return;
        // Our own optimistic edits are already on screen; their echo would refetch over them.
        if (currentUserId && event.actorId === currentUserId) return;
        pending.current.add(event.code);
        if (!timer.current) timer.current = setTimeout(flush, COALESCE_MS);
      },
      [ROADMAP_V2_SOCKET.PRESENCE]: (payload: unknown) => {
        const event = payload as RoadmapPresenceEvent;
        if (!event?.code || !openRef.current) return;
        if (event.code.toUpperCase() !== openRef.current.toUpperCase()) return;
        setPresence(current => applyPresence(current, event, Date.now(), currentUserId));
      },
    }),
    [currentUserId, flush],
  );

  // `emit` comes from the hook being configured, so onConnected reaches it through a ref.
  const emitRef = useRef<((event: string, payload?: unknown) => void) | null>(null);
  const { emit } = useAllySocket({
    namespace: "product-roadmap",
    label: "Roadmap v2 Socket",
    enabled,
    handlers,
    onConnected: () => {
      // Rooms live on the server connection: a reconnect starts with none, so join both again.
      emitRef.current?.(ROADMAP_V2_SOCKET.JOIN_BOARD);
      if (openRef.current)
        emitRef.current?.(ROADMAP_V2_SOCKET.JOIN_ITEM, { code: openRef.current });
    },
  });
  emitRef.current = emit as (event: string, payload?: unknown) => void;

  // Join the open idea's room and announce "viewing" on a slow beat; leave when it closes.
  useEffect(() => {
    setPresence([]);
    if (!enabled || !openCode) return undefined;
    emit(ROADMAP_V2_SOCKET.JOIN_ITEM, { code: openCode });
    const beat = () => emit(ROADMAP_V2_SOCKET.PRESENCE, { code: openCode, kind: "viewing" });
    beat();
    const interval = setInterval(beat, VIEWING_BEAT_MS);
    return () => {
      clearInterval(interval);
      emit(ROADMAP_V2_SOCKET.LEAVE_ITEM, { code: openCode });
    };
  }, [enabled, openCode, emit]);

  // Expire stale presence even when no new events arrive.
  useEffect(() => {
    if (presence.length === 0) return undefined;
    const interval = setInterval(() => {
      const now = Date.now();
      setPresence(current => {
        const next = current.filter(p => now - p.at < PRESENCE_TTL_MS);
        return next.length === current.length ? current : next;
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [presence.length]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * "Ana is answering…" (§4.12): tell the item room you're typing in one question's box (or the
   * comment box). Throttled here, so callers can call it on every keystroke.
   */
  const lastTyping = useRef<{ key: string; at: number } | null>(null);
  const announceTyping = useCallback(
    (questionId?: string) => {
      const code = openRef.current;
      if (!enabled || !code) return;
      const key = `${code}:${questionId ?? ""}`;
      const now = Date.now();
      if (lastTyping.current?.key === key && now - lastTyping.current.at < TYPING_BEAT_MS) return;
      lastTyping.current = { key, at: now };
      emit(ROADMAP_V2_SOCKET.PRESENCE, {
        code,
        kind: "typing",
        ...(questionId ? { questionId } : {}),
      });
    },
    [enabled, emit],
  );

  // The question cards and the comment box read presence from here (session/presenceContext).
  useEffect(() => {
    if (!enabled) return undefined;
    publishRoadmapPresence({ presence, announceTyping });
    return () => publishRoadmapPresence(null);
  }, [enabled, presence, announceTyping]);

  return { presence, announceTyping };
};
