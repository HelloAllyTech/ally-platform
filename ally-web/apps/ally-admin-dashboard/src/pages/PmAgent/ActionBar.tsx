import React, { useEffect, useRef, useState } from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import type { PmCard, PmRecommendationPayload } from "@types";

import { copy } from "./copy";

export interface ActionBarProps {
  card: PmCard & { payload: PmRecommendationPayload };
  disabled?: boolean;
  /** True while the medium/high-risk inline confirm is showing. */
  confirming: boolean;
  /** Sticky to the bottom of the viewport on small screens. */
  sticky?: boolean;
  onAccept: () => void;
  onConfirmAccept: () => void;
  onCancelConfirm: () => void;
  onDownload: () => void;
  onReject: () => void;
  onFeedback: () => void;
}

/**
 * Accept and build (primary, with the consequence chip), Reject, Give feedback. The accept
 * button's secondary menu holds Download plan.md. Medium and high risk ask one inline confirm.
 */
export const ActionBar: React.FC<ActionBarProps> = ({
  card,
  disabled,
  confirming,
  sticky,
  onAccept,
  onConfirmAccept,
  onCancelConfirm,
  onDownload,
  onReject,
  onFeedback,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const risk = card.payload.risk;

  return (
    <div
      className={`flex flex-col gap-2 border-t border-neutral-500 bg-white pt-3 ${
        sticky ? "sticky bottom-0 z-10 pb-3 lg:static" : ""
      }`}
    >
      {confirming && (
        <div
          role="alertdialog"
          aria-label={copy.confirmTitle(copy.risk[risk])}
          className="flex flex-col gap-2 rounded border border-amber-600 bg-amber-50 p-3"
        >
          <p className="text-sm text-typography-900">
            <span className="font-semibold">{copy.confirmTitle(copy.risk[risk])} </span>
            {copy.confirmBody(card.payload.riskWhy)}
          </p>
          <div className="flex gap-2">
            <Button size="md" disabled={disabled} onClick={onConfirmAccept} autoFocus>
              {copy.confirmYes}
            </Button>
            <Button kind="ghost" size="md" onClick={onCancelConfirm}>
              {copy.confirmNo}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative inline-flex" ref={menuRef}>
          <Button size="md" disabled={disabled} onClick={onAccept}>
            {copy.accept} <kbd className="ml-2 text-xs opacity-80">A</kbd>
          </Button>
          <button
            type="button"
            aria-label={copy.acceptMenu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={() => setMenuOpen(o => !o)}
            className="min-h-11 min-w-11 cursor-pointer bg-primary-700 px-2 text-white disabled:cursor-not-allowed disabled:opacity-60 md:min-h-12"
          >
            <span aria-hidden="true">▾</span>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-20 mt-1 min-w-48 rounded border border-neutral-500 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className="min-h-11 w-full cursor-pointer px-3 text-left text-sm text-typography-900 hover:bg-neutral-100"
                onClick={() => {
                  setMenuOpen(false);
                  onDownload();
                }}
              >
                {copy.downloadPlan}
              </button>
            </div>
          )}
        </div>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-typography-700">
          {copy.shipsAuto}
        </span>
        <Button kind="tertiary" size="md" disabled={disabled} onClick={onReject}>
          {copy.reject} <kbd className="ml-2 text-xs opacity-80">R</kbd>
        </Button>
        <Button kind="ghost" size="md" disabled={disabled} onClick={onFeedback}>
          {copy.feedback} <kbd className="ml-2 text-xs opacity-80">F</kbd>
        </Button>
      </div>
    </div>
  );
};
