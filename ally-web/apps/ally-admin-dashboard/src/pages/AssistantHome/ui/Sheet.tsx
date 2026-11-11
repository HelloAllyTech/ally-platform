import React, { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A panel over the page with a scrim (chunk 20d-2): the Change and Try it panels below 1600 px,
 * and steps like connecting a number. Esc and the scrim close it, focus stays inside while it's
 * open, and goes back to what opened it when it closes.
 */
export const Sheet: React.FC<{
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  side?: "right" | "bottom";
  testId?: string;
}> = ({ label, onClose, children, side = "right", testId }) => {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className={`ally-sheet ally-sheet--${side}`} data-testid={testId}>
      <div className="ally-sheet__scrim" aria-hidden="true" onClick={() => close.current()} />
      <div
        ref={panel}
        className="ally-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
};
