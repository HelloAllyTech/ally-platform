import { useEffect, useRef } from "react";

/** What a keypress means on the roadmap list. */
export type ShortcutAction =
  | "down"
  | "up"
  | "open"
  | "accept"
  | "reject"
  | "assignToMe"
  | "undo"
  | "search"
  | "help"
  | "escape";

/**
 * Key → action, in one place and free of React so it can be tested without a DOM.
 *
 * `?` is shift+/ on a US layout. A real browser reports it as "?", synthesised events as "/" with
 * shiftKey set — Bug Hunter learned the same split — so both spellings count, and the shifted
 * form is tested before plain "/" or it would fall through to "focus the search box".
 */
export const resolveShortcut = (key: string, shiftKey: boolean): ShortcutAction | null => {
  switch (key) {
    case "j":
    case "ArrowDown":
      return "down";
    case "k":
    case "ArrowUp":
      return "up";
    case "o":
    case "Enter":
      return "open";
    case "a":
      return "accept";
    case "r":
      return "reject";
    case "u":
      return "assignToMe";
    case "z":
      return "undo";
    case "?":
      return "help";
    case "/":
      return shiftKey ? "help" : "search";
    case "Escape":
      return "escape";
    default:
      return null;
  }
};

/** True for anything the reader may be typing into — their keystrokes are not ours. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable === true
  );
};

export interface RoadmapShortcutHandlers {
  /** Rows the cursor can walk, in on-screen order. */
  rowIds: string[];
  cursorId: string | null;
  onCursor: (id: string) => void;
  onOpen: (id: string) => void;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onAssignToMe?: (id: string) => void;
  onUndo?: () => void;
  onSearch: () => void;
  onHelp: () => void;
  /** Return true if Escape closed something, so the key is consumed. */
  onEscape?: () => boolean;
}

/**
 * The Product Roadmap's keyboard layer: `j k o a r u z / ?` and Esc, patterned on Bug Hunter's.
 *
 * Inert while `enabled` is false (a modal or panel owns the keyboard), while the reader is typing
 * in a field, and for Ctrl/Cmd/Alt chords, which belong to the browser. Decision keys are inert
 * unless their handler is supplied, so a read-only reader's keys never do something silently.
 *
 * The handlers are read through a ref, so the listener is attached once per `enabled` change
 * instead of being torn down on every render that changes a closure.
 */
export const useRoadmapShortcuts = (enabled: boolean, handlers: RoadmapShortcutHandlers) => {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;
    const handle = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const target = event.target as HTMLElement | null;
      // Another dialog (the shortcut sheet, a confirmation) owns the keyboard while it is up.
      if (target?.closest?.('[aria-modal="true"]')) return;

      const action = resolveShortcut(event.key, event.shiftKey);
      if (!action) return;
      const h = ref.current;
      const index = h.cursorId ? h.rowIds.indexOf(h.cursorId) : -1;

      const move = (delta: number) => {
        if (h.rowIds.length === 0) return;
        const next = index < 0 ? (delta > 0 ? 0 : h.rowIds.length - 1) : index + delta;
        const id = h.rowIds[Math.min(h.rowIds.length - 1, Math.max(0, next))];
        h.onCursor(id);
        const el = document.querySelector<HTMLElement>(`[data-roadmap-row="${CSS.escape(id)}"]`);
        el?.focus({ preventScroll: true });
        // `nearest`, not `center`: a row already in view must not make the page jump.
        el?.scrollIntoView({ block: "nearest" });
      };

      switch (action) {
        case "down":
          event.preventDefault();
          move(1);
          return;
        case "up":
          event.preventDefault();
          move(-1);
          return;
        case "open":
          // Enter on a focused BUTTON is that button's own click; only claim it for a row.
          if (event.key === "Enter" && target?.tagName === "BUTTON") return;
          if (h.cursorId) {
            event.preventDefault();
            h.onOpen(h.cursorId);
          }
          return;
        case "accept":
          if (h.onAccept && h.cursorId) {
            event.preventDefault();
            h.onAccept(h.cursorId);
          }
          return;
        case "reject":
          if (h.onReject && h.cursorId) {
            event.preventDefault();
            h.onReject(h.cursorId);
          }
          return;
        case "assignToMe":
          if (h.onAssignToMe && h.cursorId) {
            event.preventDefault();
            h.onAssignToMe(h.cursorId);
          }
          return;
        case "undo":
          if (h.onUndo) {
            event.preventDefault();
            h.onUndo();
          }
          return;
        case "search":
          event.preventDefault();
          h.onSearch();
          return;
        case "help":
          event.preventDefault();
          h.onHelp();
          return;
        case "escape":
          if (h.onEscape?.()) event.preventDefault();
          return;
        default:
          return;
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled]);
};
