import React, { useState } from "react";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";

import { copy } from "./copy";
import { InfoTip } from "../../components/ally-guide/InfoTip";

export interface FeedbackDraft {
  text: string;
  chips: string[];
}

export interface FeedbackPanelProps {
  draft: FeedbackDraft;
  disabled?: boolean;
  onChange: (draft: FeedbackDraft) => void;
  onSend: (draft: FeedbackDraft, reviseNow: boolean) => void;
  onCancel: () => void;
}

/** Inline feedback panel (not a modal): chips, a required note, Send and Send and revise now. */
export const FeedbackPanel: React.FC<FeedbackPanelProps> = ({
  draft,
  disabled,
  onChange,
  onSend,
  onCancel,
}) => {
  const [error, setError] = useState<string | null>(null);

  const toggleChip = (chip: string) => {
    const has = draft.chips.includes(chip);
    onChange({
      ...draft,
      chips: has ? draft.chips.filter(c => c !== chip) : [...draft.chips, chip],
    });
  };

  const send = (reviseNow: boolean) => {
    if (!draft.text.trim()) {
      setError(copy.feedbackEmpty);
      return;
    }
    setError(null);
    onSend({ ...draft, text: draft.text.trim() }, reviseNow);
  };

  return (
    <section
      aria-label={copy.feedbackTitle}
      className="flex flex-col gap-3 rounded border border-neutral-500 bg-neutral-100 p-3"
    >
      <p className="text-sm text-typography-700">{copy.feedbackHelp}</p>
      <div role="group" aria-label="Starter notes" className="flex flex-wrap gap-2">
        {copy.feedbackChips.map(chip => {
          const on = draft.chips.includes(chip);
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={on}
              onClick={() => toggleChip(chip)}
              className={`min-h-11 cursor-pointer rounded-full border px-3 text-sm md:min-h-8 ${
                on
                  ? "border-primary-600 bg-primary-50 text-primary-700"
                  : "border-neutral-500 bg-white text-typography-800"
              }`}
            >
              <span aria-hidden="true">{on ? "✓ " : ""}</span>
              {chip}
            </button>
          );
        })}
      </div>
      <TextArea
        id="pm-feedback-text"
        labelText={copy.feedbackLabel}
        placeholder={copy.feedbackPlaceholder}
        rows={3}
        value={draft.text}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          onChange({ ...draft, text: e.target.value });
          if (error) setError(null);
        }}
        invalid={Boolean(error)}
        invalidText={error ?? ""}
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" disabled={disabled} onClick={() => send(false)}>
          {copy.feedbackSend}
        </Button>
        <span className="inline-flex items-center gap-1">
          <Button kind="secondary" size="md" disabled={disabled} onClick={() => send(true)}>
            {copy.feedbackSendNow}
          </Button>
          <InfoTip label={copy.feedbackSendNowTip} ariaLabel="About revising now" />
        </span>
        <Button kind="ghost" size="md" onClick={onCancel}>
          {copy.feedbackCancel}
        </Button>
      </div>
    </section>
  );
};
