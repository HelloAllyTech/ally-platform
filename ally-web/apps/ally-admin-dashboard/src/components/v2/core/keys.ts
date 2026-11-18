import { useEffect, useRef } from "react";

/** A, B, C… for option `index`. */
export const optionKey = (index: number): string => String.fromCharCode(65 + index);

/** Whether a key event belongs to a control that handles Enter or letters itself. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(
    el.closest(
      "input, textarea, select, [contenteditable='true'], button, a[href], [role='radio']",
    ),
  );
};

/**
 * Enter submits the current screen (DESIGN.md §4): bound while the screen is mounted, and only
 * when focus isn't on a control that already handles Enter (a button, link or text field).
 */
export const useEnterToSubmit = (onEnter: () => void, enabled = true): void => {
  const handler = useRef(onEnter);
  useEffect(() => {
    handler.current = onEnter;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      handler.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
};
