import React, { useEffect, useRef } from "react";

import { AnimatePresence, motion } from "framer-motion";

interface DrawerProps {
  /** Closed when `false`. */
  open: boolean;
  title: string;
  onClose: () => void;
  /** Prefix for the test ids: `<prefix>` on the root, `<prefix>-overlay` on the backdrop. */
  testId: string;
  /** Colours for the header band; the cream default when omitted. */
  tone?: { bg: string; fg: string };
  children: React.ReactNode;
}

/**
 * The assistants login's one side drawer: slides in from the right over a dimmed page, closes on
 * Esc, the × button or a click outside, takes focus when it opens and gives it back to whatever
 * opened it.
 */
export const Drawer: React.FC<DrawerProps> = ({ open, title, onClose, testId, tone, children }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" data-testid={testId}>
          <motion.div
            className="absolute inset-0 bg-[#1E1B4B]/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            data-testid={`${testId}-overlay`}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-[#FFFFFF] font-primary text-[#1E1B4B] shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div
              className={`flex items-center justify-between gap-4 px-6 py-5 ${
                tone ? "" : "border-b border-[#1E1B4B]/15"
              }`}
              style={tone ? { background: tone.bg, color: tone.fg } : undefined}
            >
              <h2 className="font-secondary text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`cursor-pointer px-2 text-3xl leading-none ${tone ? "hover:opacity-70" : "hover:text-[#5B4BFF]"}`}
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
