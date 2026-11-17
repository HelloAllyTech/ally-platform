import React from "react";

import type { PmReasonChip } from "@types";

import { copy } from "./copy";

const CHIPS: PmReasonChip[] = [
  "not_priority",
  "already_planned",
  "wrong_idea",
  "too_risky",
  "other",
];

export interface ReasonToastProps {
  title: string;
  onPick: (chip: PmReasonChip) => void;
  onClose: () => void;
}

/** The non-blocking toast after a reject: optional reason chips, never in the way of the next card. */
export const ReasonToast: React.FC<ReasonToastProps> = ({ title, onPick, onClose }) => (
  <div
    role="group"
    aria-label={copy.reasonPrompt}
    className="flex w-[22rem] max-w-full flex-col gap-2 rounded border border-neutral-500 bg-white p-3 shadow-lg"
  >
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm font-medium text-typography-900">{copy.rejectedToast(title)}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="min-h-11 min-w-11 cursor-pointer text-typography-600 md:min-h-0 md:min-w-0"
      >
        ×
      </button>
    </div>
    <p className="text-xs text-typography-600">{copy.reasonPrompt}</p>
    <div className="flex flex-wrap gap-2">
      {CHIPS.map(chip => (
        <button
          key={chip}
          type="button"
          onClick={() => onPick(chip)}
          className="min-h-11 cursor-pointer rounded-full border border-neutral-500 px-3 text-sm text-typography-800 hover:border-primary-600 md:min-h-8"
        >
          {copy.reasons[chip]}
        </button>
      ))}
    </div>
  </div>
);
