/**
 * Small per-browser memory for Roadmap's P4 surfaces: the Claude Code folder, visit counting for the
 * switch-day notices, and which Shipped cards already celebrated. Every read and write is wrapped:
 * a private window or blocked storage gives the defaults, never an error [FP-3131].
 */

const PREFIX = "ally.roadmap.";

export const ROADMAP_STORE_KEYS = {
  claudeCodeFolder: "claudeCodeFolder",
  visits: "visits",
  whatMovedSeen: "whatMovedSeen",
  shortcutsIntroduced: "shortcutsIntroduced",
  celebrated: "celebrated",
  movedBannerDismissed: "movedBannerDismissed",
} as const;

export type RoadmapStoreKey = (typeof ROADMAP_STORE_KEYS)[keyof typeof ROADMAP_STORE_KEYS];

export const readStore = <T>(key: RoadmapStoreKey, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeStore = <T>(key: RoadmapStoreKey, value: T): void => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: it lasts until the page closes.
  }
};

/** Once per browser session, not once per navigation. */
const sessionOnce = (key: string): boolean => {
  try {
    if (window.sessionStorage.getItem(PREFIX + key)) return false;
    window.sessionStorage.setItem(PREFIX + key, "1");
    return true;
  } catch {
    return false;
  }
};

/** Count this visit (once per browser session) and return the running total. */
export const recordVisit = (): number => {
  const visits = Math.max(0, Number(readStore<number>(ROADMAP_STORE_KEYS.visits, 0)) || 0);
  if (!sessionOnce("visitCounted")) return visits;
  writeStore(ROADMAP_STORE_KEYS.visits, visits + 1);
  return visits + 1;
};

/** Shortcuts are introduced after someone's third visit, not on the first (§4.15) [FP-1228]. */
export const SHORTCUTS_INTRO_AFTER_VISITS = 3;

export const shouldIntroduceShortcuts = (visits: number, introduced: boolean): boolean =>
  !introduced && visits >= SHORTCUTS_INTRO_AFTER_VISITS;

const celebratedCodes = (): string[] => {
  const list = readStore<unknown>(ROADMAP_STORE_KEYS.celebrated, []);
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string") : [];
};

export const hasCelebrated = (code: string): boolean =>
  celebratedCodes().includes(code.toUpperCase());

/** Keep the last 50: enough for anyone's shipped ideas, small enough to never matter. */
export const markCelebrated = (code: string): void => {
  const next = [...celebratedCodes().filter(c => c !== code.toUpperCase()), code.toUpperCase()];
  writeStore(ROADMAP_STORE_KEYS.celebrated, next.slice(-50));
};
