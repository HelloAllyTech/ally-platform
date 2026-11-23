import { useSyncExternalStore } from "react";

/**
 * What the build half and the test pane tell each other in split build: the pane says which
 * questions it couldn't answer, and the build half asks the pane to show them. A tiny store
 * rather than lifted state, so the pane stays unchanged when nothing is listening.
 */
export interface SplitBridge {
  get: () => number;
  /** The pane reports how many questions it couldn't answer. */
  setUnanswered: (n: number) => void;
  subscribe: (listener: () => void) => () => void;
  /** The pane registers how it opens its list of them (null when it goes away). */
  setOpener: (open: (() => void) | null) => void;
  openUnanswered: () => void;
}

export const createSplitBridge = (): SplitBridge => {
  let unanswered = 0;
  let opener: (() => void) | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => unanswered,
    setUnanswered: n => {
      if (n === unanswered) return;
      unanswered = n;
      listeners.forEach(l => l());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOpener: open => {
      opener = open;
    },
    openUnanswered: () => opener?.(),
  };
};

export const useBridgeUnanswered = (bridge: SplitBridge): number =>
  useSyncExternalStore(bridge.subscribe, bridge.get, bridge.get);
