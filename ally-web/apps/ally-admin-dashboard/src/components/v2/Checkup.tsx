import React, { useState } from "react";

import { Button, PrimaryButton } from "./core";

/** How one checkup question went, as the owner reads it (deck §9, §24). */
export type CheckStatus = "answered" | "declined" | "safe" | "gap" | "fix" | "asking";

export interface CheckRowLabels {
  answered: string;
  declined: string;
  safe: string;
  gap: string;
  fix: string;
  asking: string;
}

/**
 * One checkup question (DESIGN.md §4 CheckRow): a status dot, the question in quotes, a status
 * pill and where the answer came from.
 */
export const CheckRow: React.FC<{
  question: string;
  status: CheckStatus;
  source?: string | null;
  labels: CheckRowLabels;
  index?: number;
}> = ({ question, status, source, labels, index = 0 }) => (
  <li
    className={`ally-check ally-check--${status} ally-rise`}
    style={{ ["--ally-i" as string]: Math.min(index, 8) }}
    data-testid="check-row"
  >
    <span className="ally-check__dot" aria-hidden="true" />
    <span className="ally-check__question">“{question}”</span>
    <span className="ally-check__pill">{labels[status]}</span>
    {source !== undefined ? <span className="ally-check__source">{source || "—"}</span> : null}
  </li>
);

/**
 * One measure (DESIGN.md §4 MeasureCard): the plain-words title, the technical word, a large
 * number "of N", a growing bar, a one-line meaning and an explanation shown on request.
 */
export const MeasureCard: React.FC<{
  title: string;
  word: string;
  passed: number;
  total: number;
  unit: string;
  meaning: string;
  explanation: string;
  explain: boolean;
  tone?: "accent" | "good";
}> = ({ title, word, passed, total, unit, meaning, explanation, explain, tone = "accent" }) => {
  const share = total ? Math.round((passed / total) * 100) : 0;
  return (
    <article className="ally-card ally-measure" data-testid="measure-card">
      <header className="ally-measure__head">
        <h3 className="ally-measure__title">{title}</h3>
        <span className="ally-measure__word">{word}</span>
      </header>
      <p className="ally-measure__value">
        <strong>{passed}</strong> <span>{unit}</span>
      </p>
      <div
        className={`ally-measure__bar ally-measure__bar--${tone}`}
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={passed}
      >
        <span style={{ width: `${share}%` }} />
      </div>
      <p className="ally-measure__meaning">{meaning}</p>
      {explain ? <p className="ally-measure__explain">{explanation}</p> : null}
    </article>
  );
};

export interface GapCardLabels {
  prompt: string;
  said: string;
  answer: string;
  placeholder: string;
  add: string;
  notOffered: string;
  counter: string;
}

/**
 * One question the assistant couldn't answer (DESIGN.md §4 GapCard): the question, what it said,
 * an answer box, "Add answer" and "We don't offer this", and a "1 of 2" counter. `onAdd` and
 * `onNotOffered` resolve false when the change was refused, which keeps the card.
 */
export const GapCard: React.FC<{
  said: string;
  labels: GapCardLabels;
  busy?: boolean;
  onAdd: (text: string) => Promise<boolean>;
  onNotOffered: () => Promise<boolean>;
}> = ({ said, labels, busy = false, onAdd, onNotOffered }) => {
  const [value, setValue] = useState("");
  return (
    <article className="ally-card ally-gap" data-testid="gap-card">
      <div className="ally-gap__top">
        <p className="ally-gap__prompt">{labels.prompt}</p>
        <span className="ally-gap__counter">{labels.counter}</span>
      </div>
      <p className="ally-label">{labels.said}</p>
      <p className="ally-gap__said">{said}</p>
      <form
        className="ally-field"
        onSubmit={async event => {
          event.preventDefault();
          if (value.trim() && (await onAdd(value.trim()))) setValue("");
        }}
      >
        <label className="ally-field__label" htmlFor="gap-answer">
          {labels.answer}
        </label>
        <textarea
          id="gap-answer"
          className="ally-input"
          placeholder={labels.placeholder}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
        <div className="ally-btn-row">
          <PrimaryButton type="submit" disabled={!value.trim() || busy}>
            {labels.add}
          </PrimaryButton>
          <Button variant="ghost" disabled={busy} onClick={() => void onNotOffered()}>
            {labels.notOffered}
          </Button>
        </div>
      </form>
    </article>
  );
};
