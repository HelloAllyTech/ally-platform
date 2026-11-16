import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { useDispatch } from "react-redux";

import { chatbotsApi, useSaveHomeFieldMutation } from "@api";
import type { HomeFieldName, HomeFieldState, HomeFieldValues, StaleField } from "@types";

import type { AppDispatch } from "../../store";

/** Edits wait this long for the next one before saving (as Look and feel). */
export const FIELD_SAVE_DEBOUNCE_MS = 600;

export type SaveState = "idle" | "saving" | "saved" | "failed";

/** The page's one "Changed · Undo" toast, and its save status, shared by every field. */
export interface HomeSaves {
  /** Shows the toast with Undo; `message` replaces "Changed" (a deleted entry, chunk 5b). */
  changed: (undo: () => void, message?: string) => void;
  status: (state: SaveState) => void;
}

export const HomeSavesContext = createContext<HomeSaves>({
  changed: () => undefined,
  status: () => undefined,
});

export interface HomeField<T> {
  value: T;
  /** Show a new value now; it saves after a pause (or at once with `{ now: true }`). */
  set: (value: T, options?: { now?: boolean }) => void;
  /** Save what is waiting (on blur). */
  flush: () => void;
  saving: boolean;
  /** Why the last save didn't go through: refused, or changed elsewhere (then `value` is theirs). */
  error: string | null;
  /** Something the server said about a save that went through (chunk 20d-2: "Your instructions"). */
  notice: string | null;
}

const errorOf = (error: unknown): { stale?: StaleField; message?: string } => {
  const data = (error as { status?: number; data?: unknown })?.data as
    | (Partial<StaleField> & { message?: unknown })
    | undefined;
  if (data?.errorCode === "stale" && data.details) return { stale: data as StaleField };
  return { message: typeof data?.message === "string" ? data.message : undefined };
};

/**
 * One field of the assistant home, edited in place (chunk 20d). The value shows at once and is
 * saved on its own, with the version it was based on. A save refused because the field changed
 * elsewhere (another tab, another person) puts their value on screen with the server's message,
 * so nothing is silently overwritten. Each saved change offers Undo, which saves the value from
 * before it the same way.
 */
export const useHomeField = <K extends HomeFieldName>(
  botId: string,
  field: K,
  server: HomeFieldState<HomeFieldValues[K]>,
  fallbackError: string,
): HomeField<HomeFieldValues[K]> => {
  type T = HomeFieldValues[K];
  const [save] = useSaveHomeFieldMutation();
  const dispatch = useDispatch<AppDispatch>();
  const saves = useContext(HomeSavesContext);
  const [local, setLocal] = useState<{ value: T } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const queued = useRef<{ value: T } | null>(null);
  // The version the waiting edit is based on, and the value from before it (for Undo).
  const base = useRef(server);
  const latest = useRef(server);
  latest.current = server;

  useEffect(() => () => clearTimeout(timer.current), []);

  const send = useCallback(
    async (value: T, version: string, undoable: boolean, before: T) => {
      setSaving(true);
      saves.status("saving");
      try {
        const saved = await save({ id: botId, field, value, version }).unwrap();
        setError(null);
        setNotice((saved as { warning?: string }).warning ?? null);
        saves.status("saved");
        if (undoable) {
          saves.changed(() => {
            setLocal({ value: before });
            void send(before, saved.version, false, before);
          });
        }
        if (!queued.current) setLocal(null);
      } catch (failure) {
        const { stale, message } = errorOf(failure);
        if (stale) {
          // Their value wins on screen; the next edit is based on it.
          dispatch(
            chatbotsApi.util.updateQueryData("getAssistantHome", botId, home => {
              (home.fields as Record<string, HomeFieldState<unknown>>)[field] = {
                value: stale.details.value,
                version: stale.details.version,
              };
            }),
          );
          queued.current = null;
          setLocal(null);
          setError(stale.message);
          saves.status("idle");
        } else {
          setError(message ?? fallbackError);
          saves.status("failed");
        }
      } finally {
        setSaving(false);
      }
    },
    [botId, dispatch, fallbackError, field, save, saves],
  );

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = queued.current;
    queued.current = null;
    if (!next) return;
    const from = base.current;
    if (JSON.stringify(next.value) === JSON.stringify(from.value)) {
      setLocal(null);
      return;
    }
    void send(next.value, from.version, true, from.value);
  }, [send]);

  const set = useCallback(
    (value: T, options: { now?: boolean } = {}) => {
      // A new run of edits starts from what the server last said.
      if (!queued.current) base.current = latest.current;
      queued.current = { value };
      setLocal({ value });
      setError(null);
      clearTimeout(timer.current);
      if (options.now) flush();
      else timer.current = setTimeout(flush, FIELD_SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  return { value: local ? local.value : server.value, set, flush, saving, error, notice };
};
