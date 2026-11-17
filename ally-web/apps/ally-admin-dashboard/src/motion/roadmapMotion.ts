/**
 * Roadmap's motion tokens (plans/roadmap-builder-merge §4.18), built on Builder's vocabulary so the
 * two areas move the same way. Builder's own tokens live beside this in `builderMotion.ts` and are
 * unchanged; this file adds the two Roadmap needs on top (`instant`, `spring`), the framer-motion
 * shapes, and the in-app **Reduce motion** switch.
 *
 * The rules from builderMotion hold here too: nothing animates when nothing is happening, and
 * reduced motion removes the movement, never the information. Under reduced motion every
 * transition below becomes a crossfade of 100 ms or less and lands on the same final state.
 */
import { useSyncExternalStore } from "react";

import type { Transition } from "framer-motion";

import { BUILDER_DURATION, BUILDER_EASING, prefersReducedMotion } from "./builderMotion";

export const MOTION_DURATION_MS = {
  instant: 70,
  ...BUILDER_DURATION,
} as const;

export type MotionDurationToken = keyof typeof MOTION_DURATION_MS;

/** framer-motion takes cubic-bezier control points, not the CSS string. */
const BEZIER: Record<keyof typeof BUILDER_EASING, [number, number, number, number]> = {
  productive: [0.2, 0, 0.38, 0.9],
  expressive: [0.4, 0.14, 0.3, 1],
  exit: [0.2, 0, 1, 0.9],
};

export type MotionEasingToken = keyof typeof BEZIER;

/** Anything that follows a finger: swipes, sheets, pull to refresh. */
export const MOTION_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;

/** The longest a reduced-motion crossfade may take (§4.18 "Reduced motion and comfort"). */
export const REDUCED_FADE_MS = 100;

/** List entrances stagger 30 ms, and stop staggering past 8 rows. */
export const LIST_STAGGER_MS = 30;
export const LIST_STAGGER_MAX = 8;

/**
 * A framer-motion transition from tokens. Under reduced motion it collapses to a ≤100 ms fade,
 * whatever was asked for, so a caller cannot forget the guard.
 */
export const motionTransition = (
  duration: MotionDurationToken = "moderate",
  easing: MotionEasingToken = "productive",
  reduced = false,
): Transition =>
  reduced
    ? { duration: REDUCED_FADE_MS / 1000, ease: "linear" }
    : { duration: MOTION_DURATION_MS[duration] / 1000, ease: BEZIER[easing] };

/** The spring, or the reduced fade. */
export const springTransition = (reduced = false): Transition =>
  reduced ? { duration: REDUCED_FADE_MS / 1000, ease: "linear" } : MOTION_SPRING;

/** Stagger delay in seconds for list item `index`; zero under reduced motion or past the cap. */
export const listStaggerDelay = (index: number, reduced = false): number =>
  reduced || index >= LIST_STAGGER_MAX ? 0 : (index * LIST_STAGGER_MS) / 1000;

/**
 * Enter/exit variants for a row or a card: fade up 4 px, leave at about 70% of the entrance.
 * Reduced: opacity only, so the final state (visible, in place) is identical.
 */
export const fadeUpVariants = (reduced = false, distance = 4) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, y: distance },
  animate: { opacity: 1, y: 0 },
  exit: reduced ? { opacity: 0 } : { opacity: 0, y: -distance / 2 },
});

/** Pane content: a crossfade with a 12 px slide in from the right (§4.18 "Select a row"). */
export const paneVariants = (reduced = false) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0 },
});

/** A pill or chip: pops in from 90%, shrinks out. */
export const popVariants = (reduced = false) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 },
});

/** Quick open: scales from 98% and fades. */
export const dialogVariants = (reduced = false) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0 },
});

// ── the in-app Reduce motion switch ─────────────────────────────────────────────────────────────

/** localStorage key for the user-menu switch. Per browser, like the colour mode. */
export const REDUCE_MOTION_STORAGE_KEY = "ally.reduceMotion";

const listeners = new Set<() => void>();

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(REDUCE_MOTION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

/** The in-app switch alone (not the OS setting). */
export const getReduceMotionSwitch = (): boolean =>
  typeof window === "undefined" ? false : readStored();

/** Flip the in-app switch. Storage failures (private mode) keep the choice for this page only. */
let memoryFallback: boolean | null = null;
export const setReduceMotionSwitch = (on: boolean): void => {
  memoryFallback = on;
  try {
    if (on) window.localStorage.setItem(REDUCE_MOTION_STORAGE_KEY, "1");
    else window.localStorage.removeItem(REDUCE_MOTION_STORAGE_KEY);
  } catch {
    // Storage unavailable: the in-memory value carries the choice until reload.
  }
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === REDUCE_MOTION_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  let media: MediaQueryList | null = null;
  if (typeof window.matchMedia === "function") {
    media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener?.("change", listener);
  }
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener?.("change", listener);
  };
};

/** True when either the OS asks for less motion or the in-app switch is on. Read fresh each time. */
export const isMotionReduced = (): boolean =>
  prefersReducedMotion() || (memoryFallback ?? getReduceMotionSwitch());

/** Hook form of {@link isMotionReduced}; re-renders when either source changes. */
export const useReducedMotionPreference = (): boolean =>
  useSyncExternalStore(subscribe, isMotionReduced, () => false);

/** Hook for the switch itself (the user-menu control shows only the in-app half). */
export const useReduceMotionSwitch = (): [boolean, (on: boolean) => void] => {
  const value = useSyncExternalStore(
    subscribe,
    () => memoryFallback ?? getReduceMotionSwitch(),
    () => false,
  );
  return [value, setReduceMotionSwitch];
};

/**
 * Haptics (Android `navigator.vibrate`) follow the Reduce motion switch. 10 ms for a confirm;
 * 2 × 15 ms for a decline.
 */
export const haptic = (pattern: number | number[] = 10): void => {
  if (isMotionReduced()) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // Some browsers throw when vibrate is called without a user gesture; it is only a nicety.
  }
};

/** For tests: forget the in-memory fallback. */
export const __resetReduceMotionForTests = (): void => {
  memoryFallback = null;
};
