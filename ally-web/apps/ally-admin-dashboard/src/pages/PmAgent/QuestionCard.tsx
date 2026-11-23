import React, { useState } from "react";

import { Button, Tag, TextInput } from "@ally-ui-mono/ui-shared";
import type { PmCard, PmQuestionPayload } from "@types";

import { copy } from "./copy";
import { InfoTip } from "../../components/ally-guide/InfoTip";

export const MAX_CUSTOM_ANSWER = 500;

export interface QuestionCardProps {
  card: PmCard & { payload: PmQuestionPayload };
  disabled?: boolean;
  focus?: boolean;
  onPickOption: (index: number) => void;
  onCustom: (text: string) => void;
  onSkip: () => void;
}

/** Validation for the "Something else" answer; returns a message or null. */
export const validateCustomAnswer = (text: string): string | null => {
  const t = text.trim();
  if (!t) return copy.somethingElseEmpty;
  if (t.length > MAX_CUSTOM_ANSWER) return copy.somethingElseTooLong(MAX_CUSTOM_ANSWER);
  return null;
};

/** A question card: large option buttons (the suggested one marked), "Something else", Skip. */
export const QuestionCard: React.FC<QuestionCardProps> = ({
  card,
  disabled,
  focus,
  onPickOption,
  onCustom,
  onSkip,
}) => {
  const p = card.payload;
  const [customOpen, setCustomOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitCustom = () => {
    const message = validateCustomAnswer(text);
    setError(message);
    if (message) return;
    onCustom(text.trim());
  };

  return (
    <article aria-label={p.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag type="purple" size="sm">
          <span aria-hidden="true">? </span>
          {copy.kind.question}
        </Tag>
        <Tag type="gray" size="sm">
          {copy.category[card.category]}
        </Tag>
      </div>

      <h2 className={`${focus ? "text-2xl" : "text-xl"} font-semibold text-typography-900`}>
        {p.title}
      </h2>
      <p className="text-sm text-typography-800">
        <span className="font-semibold">{copy.questionAsking}: </span>
        {p.askedBecause}
      </p>
      <p className="text-sm text-typography-700">
        <span className="font-semibold">{copy.questionUsedFor}: </span>
        {p.usedFor}
      </p>

      <ul className="flex flex-col gap-2" aria-label={p.title}>
        {p.options.map((option, i) => (
          <li key={`${i}-${option.label}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPickOption(i)}
              className="flex min-h-11 w-full cursor-pointer flex-col items-start gap-1 rounded border border-neutral-500 bg-white p-3 text-left hover:border-primary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex flex-wrap items-center gap-2 text-base font-medium text-typography-900">
                <kbd className="rounded border border-neutral-500 px-1.5 text-xs text-typography-700">
                  {i + 1}
                </kbd>
                {option.label}
                {option.suggested && (
                  <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs font-semibold text-primary-700">
                    {copy.suggested}
                  </span>
                )}
              </span>
              {option.consequence && (
                <span className="text-sm text-typography-700">{option.consequence}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {p.options.some(o => o.suggested) && (
        <p className="flex items-center gap-1 text-xs text-typography-600">
          {copy.suggested}{" "}
          <InfoTip label={copy.suggestedTip} ariaLabel="About the suggested option" />
        </p>
      )}

      <div className="flex flex-wrap items-start gap-2">
        {!customOpen ? (
          <Button kind="tertiary" size="md" disabled={disabled} onClick={() => setCustomOpen(true)}>
            {copy.somethingElse}
          </Button>
        ) : (
          <form
            className="flex w-full flex-col gap-2"
            onSubmit={e => {
              e.preventDefault();
              submitCustom();
            }}
          >
            <TextInput
              id={`custom-${card.id}`}
              labelText={copy.somethingElseLabel}
              placeholder={copy.somethingElsePlaceholder}
              value={text}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              invalid={Boolean(error)}
              invalidText={error ?? ""}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="md" disabled={disabled}>
                {copy.sendAnswer}
              </Button>
              <Button
                kind="ghost"
                size="md"
                onClick={() => {
                  setCustomOpen(false);
                  setError(null);
                }}
              >
                {copy.feedbackCancel}
              </Button>
            </div>
          </form>
        )}
        <span className="inline-flex items-center gap-1">
          <Button kind="ghost" size="md" disabled={disabled} onClick={onSkip}>
            {copy.skip}
          </Button>
          <InfoTip label={copy.skipTip} ariaLabel="About skipping" />
        </span>
      </div>
    </article>
  );
};
