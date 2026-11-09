import { useCallback, useSyncExternalStore } from "react";

export type ColorMode = "light" | "dark";

/**
 * Where the admin's choice lives. index.html reads the same key in a tiny inline script
 * before the bundle loads, so a dark-mode user never sees a white flash on reload — keep
 * the two in step if this ever changes.
 */
export const COLOR_MODE_STORAGE_KEY = "ally-admin-color-mode";

/** The class every dark-mode rule keys off (the Tailwind colour tokens, see dark-mode.tailwind.js). */
const DARK_CLASS = "dark";
/**
 * Carbon's own dark "Gray 100" zone. @carbon/styles emits every `--cds-*` token for it under this
 * class, so putting it on <html> re-themes every Carbon component — including the ones portalled
 * to <body> (modals, menus, tooltips).
 */
const CARBON_DARK_CLASS = "cds--g100";

const listeners = new Set<() => void>();

/** Best-effort: storage can throw (private window, blocked site data) and must never break the shell. */
const readStored = (): ColorMode => {
  try {
    return localStorage.getItem(COLOR_MODE_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

const writeStored = (mode: ColorMode) => {
  try {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore — the switch still works for this visit
  }
};

const applyToDocument = (mode: ColorMode) => {
  const root = document.documentElement;
  root.classList.toggle(DARK_CLASS, mode === "dark");
  root.classList.toggle(CARBON_DARK_CLASS, mode === "dark");
  // Native form controls, scrollbars and autofill follow this.
  root.style.colorScheme = mode;
};

const getSnapshot = (): ColorMode =>
  document.documentElement.classList.contains(DARK_CLASS) ? "dark" : "light";

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Class that briefly cross-fades colours while the mode flips (see styles.css). */
const TRANSITION_CLASS = "color-mode-transition";
const TRANSITION_MS = 250;
let transitionTimer: ReturnType<typeof setTimeout> | undefined;

/** Sets the mode for the whole admin app and remembers it in this browser. */
export const setColorMode = (mode: ColorMode) => {
  const root = document.documentElement;
  root.classList.add(TRANSITION_CLASS);
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => root.classList.remove(TRANSITION_CLASS), TRANSITION_MS);
  applyToDocument(mode);
  writeStored(mode);
  listeners.forEach(listener => listener());
};

/**
 * Brings the document in line with the stored choice. Called once from main.tsx — the inline
 * script in index.html normally got there first; this covers anything it missed (tests,
 * storage it could not read). Light is the default: the app never follows the OS setting.
 */
export const initColorMode = () => applyToDocument(readStored());

/** The admin app's light/dark mode, shared by every component that reads it. */
export const useColorMode = () => {
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => "light" as ColorMode);
  const toggle = useCallback(() => setColorMode(getSnapshot() === "dark" ? "light" : "dark"), []);
  return { mode, isDark: mode === "dark", toggle };
};
