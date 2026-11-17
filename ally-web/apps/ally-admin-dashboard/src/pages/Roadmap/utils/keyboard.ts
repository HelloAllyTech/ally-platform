/**
 * The Queue's keys (§4.10): J/K move, Enter opens, Esc closes the pane, ? lists the shortcuts,
 * ⌘K / Ctrl K opens quick open. Shortcuts are off while typing in any box; only quick open's chord
 * still works there, as it does in every app that has one.
 */

export type QueueKeyAction = "next" | "previous" | "open" | "close" | "help" | "quickOpen";

export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable) return true;
  return element.getAttribute?.("role") === "textbox";
};

interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target: EventTarget | null;
}

export const queueKeyAction = (event: KeyLike): QueueKeyAction | null => {
  const key = event.key;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && key.toLowerCase() === "k") {
    return "quickOpen";
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  switch (key) {
    case "j":
    case "J":
      return "next";
    case "k":
    case "K":
      return "previous";
    case "Enter":
      return "open";
    case "Escape":
      return "close";
    case "?":
      return "help";
    default:
      return null;
  }
};

/** Move a selection through `codes`; wraps neither end, and starts at the top from nothing. */
export const stepSelection = (
  codes: string[],
  current: string | undefined,
  direction: 1 | -1,
): string | undefined => {
  if (codes.length === 0) return undefined;
  const index = current ? codes.indexOf(current) : -1;
  if (index === -1) return direction === 1 ? codes[0] : codes[codes.length - 1];
  const next = Math.min(codes.length - 1, Math.max(0, index + direction));
  return codes[next];
};
