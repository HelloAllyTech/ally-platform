import React, { useEffect, useId, useRef } from "react";

import { Close } from "@icons";
import { AnimatePresence, PanInfo, motion } from "framer-motion";
import { createPortal } from "react-dom";

import { motionTransition, springTransition, useReducedMotionPreference } from "../../../motion";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Sticky footer (e.g. "Show 12 ideas"). */
  footer?: React.ReactNode;
  closeLabel: string;
  /** Full height (search, the comment sheet); otherwise it fits its content up to 85%. */
  full?: boolean;
}

/** Past this share of its height, or this fling speed, a drag closes the sheet (§4.18). */
const CLOSE_FRACTION = 0.3;
const CLOSE_VELOCITY = 600;

/**
 * Roadmap's phone sheet: rises from the bottom edge, follows the finger, flicks closed past 30% or
 * with velocity; the backdrop fades to 40%. Escape and the ✕ close it, focus moves in on open and
 * back to the opener on close, and Tab stays inside while it's open. Safe-area insets are kept, so
 * the footer clears the home indicator on notched phones.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel,
  full = false,
}) => {
  const reduced = useReducedMotionPreference();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        "input, button, [href], select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      (first ?? panelRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "input, button, [href], select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter(el => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const height = panelRef.current?.offsetHeight ?? 1;
    if (info.offset.y > height * CLOSE_FRACTION || info.velocity.y > CLOSE_VELOCITY) onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9050]" data-testid="roadmap-bottom-sheet">
          <motion.div
            className="absolute inset-0 bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={motionTransition("moderate", "productive", reduced)}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl bg-white shadow-lg outline-none ${
              full ? "h-[92dvh]" : "max-h-[85dvh]"
            }`}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={springTransition(reduced)}
            drag={reduced ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div className="flex justify-center pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-neutral-300" />
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-1">
              <h2 id={titleId} className="text-base font-semibold text-typography-primary">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100"
              >
                <Close size={20} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 text-base">
              {children}
            </div>
            {footer && <div className="border-t border-border-light px-4 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
