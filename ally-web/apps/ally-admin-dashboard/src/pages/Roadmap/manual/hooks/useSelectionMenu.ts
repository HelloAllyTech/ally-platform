import { RefObject, useCallback, useEffect, useRef, useState } from "react";

import { MANUAL_SELECTION_MAX } from "./useManualChatStream";

export interface ManualSelection {
  text: string;
  /** Viewport rect of the selection, for placing the floating menu. */
  rect: { top: number; left: number; width: number; height: number };
}

/** The selected text inside `container`, or null. Exported for tests. */
export const readSelectionWithin = (
  container: HTMLElement | null,
  selection: Selection | null,
): ManualSelection | null => {
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element || !container.contains(element)) return null;
  const text = selection.toString().replace(/\s+/g, " ").trim();
  if (!text) return null;
  const box =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : { top: 0, left: 0, width: 0, height: 0 };
  return {
    text: text.slice(0, MANUAL_SELECTION_MAX),
    rect: { top: box.top, left: box.left, width: box.width, height: box.height },
  };
};

/**
 * Text selected in the page body → a small floating menu (Ask about this · Start a draft idea).
 * The menu follows mouseup / keyup (so it appears once a drag ends, not mid-drag), and hides on
 * scroll, on Escape, and when the selection collapses or leaves the body.
 *
 * `last` keeps the most recent selection after the menu hides, so the header's overflow menu (the
 * keyboard route to the same two actions) can still act on it once focus has moved to the menu.
 */
export const useSelectionMenu = (
  containerRef: RefObject<HTMLElement | null>,
  resetKey?: string,
): {
  selection: ManualSelection | null;
  last: ManualSelection | null;
  dismiss: () => void;
} => {
  const [selection, setSelection] = useState<ManualSelection | null>(null);
  const lastRef = useRef<ManualSelection | null>(null);
  const [, force] = useState(0);

  const dismiss = useCallback(() => setSelection(null), []);

  useEffect(() => {
    lastRef.current = null;
    setSelection(null);
    force(n => n + 1);
  }, [resetKey]);

  useEffect(() => {
    const capture = () => {
      const next = readSelectionWithin(containerRef.current, window.getSelection?.() ?? null);
      setSelection(next);
      if (next) {
        lastRef.current = next;
        force(n => n + 1);
      }
    };
    const onUp = () => requestAnimationFrame(capture);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      if (event.shiftKey || event.key.startsWith("Arrow")) capture();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    const onSelectionChange = () => {
      const current = window.getSelection?.();
      if (!current || current.isCollapsed) setSelection(null);
    };
    const onScroll = () => setSelection(null);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onScroll);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onScroll);
    };
  }, [containerRef]);

  return { selection, last: lastRef.current, dismiss };
};
