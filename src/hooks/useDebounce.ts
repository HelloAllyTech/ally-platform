import {useCallback, useRef} from 'react';

interface DebounceOptions {
  delay?: number;
  leading?: boolean; // If true, call on the leading edge (immediately) instead of trailing
}

/**
 * A hook that returns a debounced version of the provided function.
 *
 * The constraint is `never[]`, not `unknown[]`: function parameters are
 * contravariant, so `(query: string) => void` is NOT assignable to
 * `(...args: unknown[]) => unknown` — `unknown` cannot be narrowed to
 * `string`. With `unknown[]` this hook accepted essentially no real callback,
 * and every caller was a type error. `never[]` is the constraint that means
 * "any function" while keeping `Parameters<T>` exact at the call site.
 * @param callback The function to debounce
 * @param options.delay The delay in milliseconds (default: 1000ms)
 * @param options.leading Whether to call the function on the leading edge (default: false)
 * @returns A debounced version of the callback
 */
export const useDebounce = <T extends (...args: never[]) => unknown>(
  callback: T,
  options: DebounceOptions = {},
) => {
  const {delay = 1000, leading = false} = options;
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const callbackRef = useRef(callback);
  const leadingCallMadeRef = useRef(false);

  // Update the callback ref when the callback changes
  callbackRef.current = callback;

  return useCallback(
    (...args: Parameters<T>) => {
      const invokeFunction = () => {
        callbackRef.current(...args);
        leadingCallMadeRef.current = false;
      };

      if (leading && !leadingCallMadeRef.current) {
        // If leading=true and we haven't made the leading call yet,
        // call immediately and set the flag
        invokeFunction();
        leadingCallMadeRef.current = true;
      }

      // Clear the existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set a new timeout
      timeoutRef.current = setTimeout(() => {
        if (!leading) {
          // For trailing edge, call after the delay
          invokeFunction();
        }
        leadingCallMadeRef.current = false;
      }, delay);
    },
    [delay, leading],
  );
};
