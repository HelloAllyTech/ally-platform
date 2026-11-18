import { useEffect, useRef, useState } from "react";

import { BuilderClient } from "@types";

import { AllySocketStatus, useAllySocket } from "../../../hooks/useAllySocket";

/** Carbon's breakpoints: sm under 672px is a phone, md up to 1055px, lg two columns. */
const PHONE_QUERY = "(max-width: 671px)";
const DESKTOP_QUERY = "(min-width: 1056px)";
/** Key hints only for a fine pointer — never by width (a narrow desktop window keeps them). */
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

const matches = (query: string): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

const useMedia = (query: string): boolean => {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setValue(list.matches);
    onChange();
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, [query]);
  return value;
};

export interface RoomLayout {
  layout: BuilderClient;
  finePointer: boolean;
}

/** Which of the three layouts to draw, and whether to show key hints. */
export const useRoomLayout = (): RoomLayout => {
  const phone = useMedia(PHONE_QUERY);
  const desktop = useMedia(DESKTOP_QUERY);
  const finePointer = useMedia(FINE_POINTER_QUERY);
  return { layout: phone ? "phone" : desktop ? "desktop" : "tablet", finePointer };
};

/**
 * Refetch on the `/builder` socket's payload-free change events, and when the
 * tab comes back from being suspended (phones do this constantly). Returns
 * whether live updates are paused so the page can say so quietly.
 */
export const useBuilderLive = (refetch: () => void): { paused: boolean; refreshedAt: number } => {
  const [status, setStatus] = useState<AllySocketStatus>(AllySocketStatus.CONNECTING);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const handlersRef = useRef<Record<string, (payload: unknown) => void>>({
    decisionsChanged: () => refetchRef.current(),
    sessionsChanged: () => refetchRef.current(),
  });

  useAllySocket({
    namespace: "builder",
    label: "builder-now",
    handlers: handlersRef.current,
    onStatusChange: setStatus,
    onReconnected: () => refetchRef.current(),
  });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refetchRef.current();
      setRefreshedAt(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return {
    paused: status === AllySocketStatus.ERROR || status === AllySocketStatus.RECONNECTING,
    refreshedAt,
  };
};

/** Whether the browser thinks it is online. Offline, nothing sends — never silently queued. */
export const useOnline = (): boolean => {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
};

const DRAFT_PREFIX = "builder-room-draft:";

/**
 * A draft kept in localStorage so a suspended phone tab doesn't lose a
 * half-typed answer or instruction. Every access is guarded: storage can be
 * full, blocked or absent, and the page must work without it.
 */
export const useDraft = (key: string | null): [string, (value: string) => void] => {
  const read = (k: string | null) => {
    if (!k) return "";
    try {
      return window.localStorage.getItem(DRAFT_PREFIX + k) ?? "";
    } catch {
      return "";
    }
  };
  const [value, setValue] = useState(() => read(key));
  useEffect(() => {
    setValue(read(key));
  }, [key]);
  const update = (next: string) => {
    setValue(next);
    if (!key) return;
    try {
      if (next) window.localStorage.setItem(DRAFT_PREFIX + key, next);
      else window.localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      // storage unavailable: the draft lives only in memory
    }
  };
  return [value, update];
};
