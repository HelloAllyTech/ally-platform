import React, { useEffect, useRef } from "react";

import { Close } from "@icons";

interface SheetProps {
  title: string;
  /** `bottom` on a phone; `side` slides in from the right on wider screens. */
  placement: "bottom" | "side";
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * A modal sheet. The page opens it with a history entry, so the phone's back
 * gesture closes it rather than leaving the Builder tab; this only draws it,
 * traps Escape, and puts focus inside.
 */
export const Sheet: React.FC<SheetProps> = ({ title, placement, onClose, children, footer }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          "absolute flex flex-col bg-white focus:outline-none",
          placement === "bottom"
            ? "inset-x-0 bottom-0 max-h-[88vh] rounded-t-lg pb-[env(safe-area-inset-bottom)]"
            : "inset-y-0 right-0 w-full max-w-[520px] border-l border-border-light",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center hover:bg-neutral-100"
          >
            <Close className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
