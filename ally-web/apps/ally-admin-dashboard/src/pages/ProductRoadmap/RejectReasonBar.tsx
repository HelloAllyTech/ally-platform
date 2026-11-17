import React, { useEffect } from "react";

import { en } from "@constants/en";

import { REJECT_REASONS, RejectReasonId } from "./utils/triage";

interface RejectReasonBarProps {
  code: string;
  /** A reason, or undefined for "No reason". */
  onChoose: (reason?: RejectReasonId) => void;
  onCancel: () => void;
}

/**
 * The optional reason for a rejection: four one-tap chips and a skip.
 *
 * Skippable on purpose — a required reason is how a one-key reject turns back into a form. It is a
 * non-modal bar, not a dialog, so the list stays in view and the reader can see which row it is
 * about. Keys: 1-4 pick a reason, Enter or 0 skips, Esc cancels the rejection. It owns the
 * keyboard while it is up (the page disables the list shortcuts), in the capture phase so these
 * digits never reach anything underneath.
 */
export const RejectReasonBar: React.FC<RejectReasonBarProps> = ({ code, onChoose, onCancel }) => {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === "Enter" || event.key === "0") {
        event.preventDefault();
        event.stopPropagation();
        onChoose(undefined);
        return;
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < REJECT_REASONS.length) {
        event.preventDefault();
        event.stopPropagation();
        onChoose(REJECT_REASONS[index].id);
      }
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [onChoose, onCancel]);

  return (
    <div
      role="group"
      aria-label={en.roadmapTriage.rejectTitle}
      className="border-border-light fixed bottom-4 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-col gap-2 border bg-white p-3 shadow-lg"
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-typography-primary text-sm font-medium">
          {en.roadmapTriage.rejectTitle} <span className="tabular-nums">{code}</span>
        </span>
        <span className="text-typography-secondary text-xs">{en.roadmapTriage.rejectHint}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {REJECT_REASONS.map((reason, index) => (
          <button
            key={reason.id}
            type="button"
            onClick={() => onChoose(reason.id)}
            className="border-border-light hover:border-primary-500 cursor-pointer border px-2.5 py-1 text-sm"
          >
            <kbd className="text-typography-secondary mr-1.5 font-mono text-xs">{index + 1}</kbd>
            {en.roadmapTriage.rejectReasons[reason.key]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChoose(undefined)}
          className="text-typography-secondary hover:text-primary-500 cursor-pointer px-2 py-1 text-sm"
        >
          {en.roadmapTriage.rejectSkip}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-typography-secondary hover:text-primary-500 cursor-pointer px-2 py-1 text-sm"
        >
          {en.roadmapTriage.rejectCancel}
        </button>
      </div>
    </div>
  );
};
