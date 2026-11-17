import { useCallback, useRef, useState } from "react";

/** How far to pull before a release refreshes, and the most the indicator travels. */
export const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
/** Rubber-band: the indicator moves at this fraction of the finger. */
const RESISTANCE = 0.5;

/** Pure: the indicator's travel for a finger distance. */
export const pullDistance = (fingerDelta: number): number =>
  fingerDelta <= 0 ? 0 : Math.min(PULL_MAX, fingerDelta * RESISTANCE);

/**
 * Pull down to refresh (§4.17), touch only. It starts only when the scroll container is already at
 * the top, so it never fights a normal scroll. The header's ↻ button is the visible equivalent.
 * Touch events, not pointer events: a pointer-based drag would also fire for a mouse drag-select.
 */
export const usePullToRefresh = (
  getScroller: () => HTMLElement | null,
  onRefresh: () => Promise<unknown> | void,
  enabled: boolean,
) => {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled || refreshing) return;
      const scroller = getScroller();
      if (scroller && scroller.scrollTop > 0) return;
      startY.current = event.touches[0]?.clientY ?? null;
    },
    [enabled, refreshing, getScroller],
  );

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    if (startY.current === null) return;
    const delta = (event.touches[0]?.clientY ?? startY.current) - startY.current;
    setDistance(pullDistance(delta));
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (startY.current === null) return;
    startY.current = null;
    if (distance >= PULL_THRESHOLD * RESISTANCE) {
      setRefreshing(true);
      setDistance(PULL_THRESHOLD * RESISTANCE);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setDistance(0);
      }
    } else {
      setDistance(0);
    }
  }, [distance, onRefresh]);

  return {
    distance,
    refreshing,
    armed: distance >= PULL_THRESHOLD * RESISTANCE,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
};
