import { useEffect, useState } from "react";

/**
 * `value`, but only after it has stopped changing for `delayMs`.
 *
 * The shared `useDebounce` hook wraps a callback; the roadmap needs the other shape — a value that
 * feeds a query key — so the input can stay instant while the request waits for a pause.
 */
export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};
