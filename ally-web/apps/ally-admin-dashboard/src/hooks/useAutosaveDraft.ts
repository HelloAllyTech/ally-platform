import { useCallback, useEffect, useRef, useState } from "react";

import type { AutosaveStatus } from "@components/autosave-indicator";

interface Options<T> {
  /** localStorage key, unique per entity (e.g. `case-draft:${id}`). */
  storageKey: string;
  /** Current form value. Autosave triggers when it changes (deep-compared via JSON). */
  value: T;
  /** Skip while the form has not loaded / is read-only. */
  enabled?: boolean;
  delayMs?: number;
  /** Optional server save. If omitted the draft is only kept locally (restorable). */
  save?: (value: T) => Promise<unknown>;
  /** Also keep a local copy for `restore()`. Off when the server save is the record. */
  persistLocal?: boolean;
}

/**
 * Debounced autosave with a Saved/Saving indicator state. Always writes a local draft first
 * (so a crash/refresh never loses work), then calls `save` if given. `restore()` returns a
 * stored draft that differs from the current value; `clearDraft()` after an explicit save.
 */
export const useAutosaveDraft = <T>({
  storageKey,
  value,
  enabled = true,
  delayMs = 1500,
  save,
  persistLocal = true,
}: Options<T>) => {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const lastSerialised = useRef<string>(JSON.stringify(value));
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!enabled) return undefined;
    const serialised = JSON.stringify(value);
    if (serialised === lastSerialised.current) return undefined;
    const timer = setTimeout(async () => {
      lastSerialised.current = serialised;
      try {
        if (persistLocal) localStorage.setItem(storageKey, serialised);
      } catch {
        /* storage full/blocked: fall through to server save */
      }
      if (!saveRef.current) {
        setStatus("saved");
        setSavedAt(new Date());
        return;
      }
      setStatus("saving");
      try {
        await saveRef.current(value);
        setStatus("saved");
        setSavedAt(new Date());
      } catch {
        setStatus("error");
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, enabled, delayMs, storageKey, persistLocal]);

  const restore = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw || raw === JSON.stringify(value)) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [storageKey, value]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { status, savedAt, restore, clearDraft };
};
