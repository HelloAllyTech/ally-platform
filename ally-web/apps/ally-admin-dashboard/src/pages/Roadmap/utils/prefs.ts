/**
 * Per-person choices remembered in this browser (§4.11): the last view, the side-panel
 * tab and width, Show agent work. Every read and write is wrapped: a private window or blocked
 * storage gives the defaults, never an error.
 */

const PREFIX = "ally.roadmap.";

export const ROADMAP_PREF_KEYS = {
  lastView: "lastView",
  panelTab: "panelTab",
  panelWidth: "panelWidth",
  panelOpen: "panelOpen",
  showAgentWork: "showAgentWork",
} as const;

export type RoadmapPrefKey = (typeof ROADMAP_PREF_KEYS)[keyof typeof ROADMAP_PREF_KEYS];

export const readPref = <T>(key: RoadmapPrefKey, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writePref = <T>(key: RoadmapPrefKey, value: T): void => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice lasts until the page closes, which is the best we can do.
  }
};

/** Clamp the remembered side-panel width to something that leaves the conversation readable. */
export const PANEL_WIDTH = { min: 320, max: 640, default: 420 } as const;
export const clampPanelWidth = (width: unknown): number => {
  const n = typeof width === "number" && Number.isFinite(width) ? width : PANEL_WIDTH.default;
  return Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, Math.round(n)));
};
