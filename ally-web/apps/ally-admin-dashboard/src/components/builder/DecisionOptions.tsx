import React from "react";

import { en } from "@constants";
import { BuilderDecisionOption } from "@types";

export interface DecisionOptionsProps {
  /** Already in the order to show them (`orderOptions`: the recommendation first). */
  options: BuilderDecisionOption[];
  picked: string[];
  isMulti: boolean;
  disabled: boolean;
  onChoose: (option: BuilderDecisionOption) => void;
  /**
   * The feed's keyboard hints: the digit that picks each option and "press Enter" on the
   * recommendation. Off where the keyboard does not answer (the PM agent's idea card).
   */
  keyboard?: boolean;
}

/**
 * A Builder question's options, one button each: the label, the trade-off line, the
 * recommendation badge and, on an option hard to take back, what a click does. The decision
 * feed and the PM agent's idea card both draw Builder's options with this, so a question reads
 * the same wherever it is answered.
 */
export const DecisionOptions: React.FC<DecisionOptionsProps> = ({
  options,
  picked,
  isMulti,
  disabled,
  onChoose,
  keyboard = true,
}) => {
  const strings = en.builder.decisions;
  if (options.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2" aria-label="Options">
      {options.map((option, index) => {
        const isPicked = picked.includes(option.id);
        return (
          <li key={option.id}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={isPicked}
              onClick={() => onChoose(option)}
              className={[
                "flex w-full items-start gap-3 rounded border px-3 py-2 text-left transition-colors",
                "hover:border-primary-500 hover:bg-primary-50",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isPicked
                  ? "border-primary-600 bg-primary-50 ring-1 ring-primary-600"
                  : option.recommended
                    ? "border-primary-400 bg-primary-50/40"
                    : "border-neutral-300",
              ].join(" ")}
            >
              {/* The key that picks it, as a badge: the shortcut is taught where it is used. */}
              {keyboard && (
                <kbd className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-neutral-300 bg-white px-1 font-mono text-xs text-typography-700">
                  {index + 1}
                </kbd>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-typography-900">{option.label}</span>
                  {option.recommended && (
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {strings.card.recommended}
                      {keyboard &&
                        !isMulti &&
                        ` · ${option.confirm ? strings.card.pressEnterTwice : strings.card.pressEnter}`}
                    </span>
                  )}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-typography-600">
                    {option.description}
                  </span>
                )}
                {keyboard && !isMulti && option.confirm && (
                  <span className="mt-0.5 block text-xs font-medium text-typography-700">
                    {isPicked ? strings.card.confirmPicked : strings.card.hardToUndo}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};
