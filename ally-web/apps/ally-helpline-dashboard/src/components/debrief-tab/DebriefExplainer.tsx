import { FC, KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The explainer's paragraphs, in order (PRD §6.12 copy, plan §7.5). */
const PARAGRAPHS = ["how", "quotes", "wrong", "supervisor"] as const;

/**
 * "How Ally writes your debrief" in the header strip (PRD §6.3, FR-26): a
 * link that opens a short, static explainer — Ally checks and revises its own
 * draft, quotes are checked, it can still be wrong, and supervisors can read
 * debriefs. A modal dialog: focus moves to Close, Escape closes it, and focus
 * goes back to the link.
 */
export const DebriefExplainer: FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
    // One focusable control inside: keep Tab on it.
    if (event.key === "Tab") {
      event.preventDefault();
      closeRef.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="debrief-explainer-link"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center rounded-md px-1 font-primary text-sm text-white underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        {t("postSim.debriefCards.explainer.link")}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-typography-900/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="debrief-explainer"
            onKeyDown={onKeyDown}
            onClick={event => event.stopPropagation()}
            className="flex w-full max-w-lg flex-col gap-3 rounded-lg bg-white p-5 sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="font-primary text-base font-semibold text-typography-900">
                {t("postSim.debriefCards.explainer.title")}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("postSim.debriefCards.explainer.close")}
                className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-typography-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            {PARAGRAPHS.map(key => (
              <p key={key} className="font-primary text-sm leading-relaxed text-typography-800">
                {t(`postSim.debriefCards.explainer.${key}`)}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
