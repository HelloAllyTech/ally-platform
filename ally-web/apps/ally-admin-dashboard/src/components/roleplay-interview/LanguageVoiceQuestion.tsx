import React, { useState } from "react";

import { en } from "@constants";
import { AgentQuestionEvent } from "@types";

import { LanguageVoiceChoice, LanguageVoicePicker } from "./LanguageVoicePicker";

interface LanguageVoiceQuestionProps {
  /** The agent's question; its options' `value`s are language ids, the recommended ones pre-ticked. */
  question: AgentQuestionEvent;
  /** The trainer's current choice (shared with the Brief tab). */
  value: LanguageVoiceChoice;
  answered: boolean;
  disabled?: boolean;
  /** Confirm: the chosen languages (with voices) and the answer text for the chat. */
  onConfirm: (choice: LanguageVoiceChoice) => void;
}

/**
 * The agent's "which languages, which voices" question, answered in the chat with the language
 * and voice picker (a voice per language, with a sample to play) instead of plain options.
 */
export const LanguageVoiceQuestion: React.FC<LanguageVoiceQuestionProps> = ({
  question,
  value,
  answered,
  disabled,
  onConfirm,
}) => {
  const strings = en.roleplayInterview.voices;
  // Start from what is already chosen, else the languages the agent recommends.
  const [draft, setDraft] = useState<LanguageVoiceChoice>(() =>
    Object.keys(value).length
      ? value
      : Object.fromEntries(
          (question.options ?? [])
            .filter(option => option.recommended && option.value)
            .map(option => [String(option.value), ""]),
        ),
  );
  const picked = Object.keys(draft).length;

  return (
    <div
      className="self-start w-full rounded-md border border-border-light bg-background-secondary p-4"
      data-testid="language-voice-question"
    >
      <p className="mb-3 text-sm font-medium text-typography-900">{question.prompt}</p>
      <LanguageVoicePicker value={draft} onChange={setDraft} disabled={answered || disabled} />
      {answered ? (
        <p className="mt-3 text-xs font-medium text-success-700">✓ {strings.confirmed}</p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-typography-600">
            {picked ? strings.pickedCount(picked) : strings.pickOne}
          </span>
          <button
            type="button"
            disabled={!picked || disabled}
            onClick={() => onConfirm(draft)}
            className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {strings.confirm}
          </button>
        </div>
      )}
    </div>
  );
};
