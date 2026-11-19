import { type FC, useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { BreathingPacer } from "./BreathingPacer";

/**
 * "Take a breath while you wait": a quiet link under the debrief box, at its bottom right. It opens
 * the breathing pacer as one dark card centred over the whole page (a portal on the page body, so
 * nothing inside the debrief has to make room). The learner starts it and closes it with Stop,
 * Escape or a click outside; nothing starts for them.
 */
export const BreathingPopup: FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const stopRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    stopRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex w-full justify-end">
      <button
        type="button"
        data-testid="debrief-breathe-start"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] items-center px-1 font-primary text-sm text-typography-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {t("postSim.debriefCards.working.breatheStart")}
      </button>
      {open &&
        createPortal(
          <div
            data-testid="debrief-breathe-backdrop"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("postSim.debriefCards.working.breatheStart")}
              data-testid="debrief-breathe-popup"
              onClick={e => e.stopPropagation()}
              className="flex w-[min(340px,92vw)] flex-col items-center gap-2 rounded-2xl bg-typography-900 px-6 pb-3 pt-6"
            >
              <BreathingPacer bare />
              <button
                ref={stopRef}
                type="button"
                data-testid="debrief-breathe-stop"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center px-4 font-primary text-sm text-white/80 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {t("postSim.debriefCards.working.breatheStop")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
