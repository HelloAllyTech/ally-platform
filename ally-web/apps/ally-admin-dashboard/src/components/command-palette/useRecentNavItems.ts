import { useCallback, useState } from "react";

const STORAGE_KEY = "admin_command_palette_recents";
export const MAX_RECENTS = 5;

const read = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

/** The ids of the last few pages this browser opened, newest first. Per browser, never synced. */
export const useRecentNavItems = () => {
  const [recents, setRecents] = useState<string[]>(read);

  const record = useCallback((id: string) => {
    const next = [id, ...read().filter(existing => existing !== id)].slice(0, MAX_RECENTS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: recents just don't persist.
    }
    setRecents(next);
  }, []);

  return { recents, record };
};
