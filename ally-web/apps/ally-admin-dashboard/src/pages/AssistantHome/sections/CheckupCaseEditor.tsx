import React, { useId, useState } from "react";

import { Button } from "@components/v2";

import { HOME, fill } from "../copy";

import type { CheckupCaseInput, CheckupOutcomeChoice } from "../../../types/checkup";

const t = HOME.checkupControls;

const OUTCOMES: CheckupOutcomeChoice[] = ["answer", "dont_know", "decline", "person"];

/** A list of short lines as chips: type one, press Enter (or Add), remove with ×. */
export const ChipsInput: React.FC<{
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Lines that can't be removed (a safety question's, which can only be added to). */
  fixed?: string[];
  disabled?: boolean;
}> = ({ label, hint, value, onChange, fixed = [], disabled }) => {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = () => {
    const line = draft.trim();
    if (!line || value.includes(line)) return setDraft("");
    onChange([...value, line].slice(0, 12));
    setDraft("");
  };
  return (
    <div className="ally-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={`${id}-hint`} className="ally-field__hint">
          {hint}
        </span>
      )}
      {value.length > 0 && (
        <ul className="ally-chips ally-checkup__chips" aria-label={label}>
          {value.map(line => (
            <li key={line} className="ally-chip ally-chip--outline">
              <span>{line}</span>
              {!disabled && !fixed.includes(line) && (
                <button
                  type="button"
                  className="ally-checkup__chip-x"
                  aria-label={fill(t.editor.removeChip, { item: line })}
                  onClick={() => onChange(value.filter(v => v !== line))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="ally-add-row">
          <input
            id={id}
            className="ally-input"
            value={draft}
            maxLength={300}
            aria-describedby={hint ? `${id}-hint` : undefined}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button className="ally-btn--sm" onClick={add} disabled={!draft.trim()}>
            {t.editor.addChip}
          </Button>
        </div>
      )}
    </div>
  );
};

export interface EditorValue {
  question: string;
  outcome: CheckupOutcomeChoice;
  facts: string[];
  mustNot: string[];
  mustPass: boolean;
  language: string;
}

/**
 * "Add a question" and editing one (chunk 20d-2): the question, what should happen, what a good
 * answer includes and must not say (chips, in the owner's words), Must pass and the language. A
 * safety question can only be added to; the parts that can't change say why.
 */
export const CheckupCaseEditor: React.FC<{
  initial?: Partial<EditorValue>;
  safety?: boolean;
  busy?: boolean;
  error?: string | null;
  title: string;
  onSave: (input: CheckupCaseInput) => void;
  onCancel: () => void;
}> = ({ initial = {}, safety = false, busy, error, title, onSave, onCancel }) => {
  const id = useId();
  const [value, setValue] = useState<EditorValue>({
    question: initial.question ?? "",
    outcome: initial.outcome ?? "answer",
    facts: initial.facts ?? [],
    mustNot: initial.mustNot ?? [],
    mustPass: initial.mustPass ?? true,
    language: initial.language ?? "",
  });
  const set = (patch: Partial<EditorValue>) => setValue(v => ({ ...v, ...patch }));
  const ready = value.question.trim().length > 0;

  return (
    <form
      className="ally-card ally-checkup__editor"
      aria-label={title}
      data-testid="checkup-editor"
      onSubmit={event => {
        event.preventDefault();
        if (!ready || busy) return;
        onSave(
          safety
            ? { facts: value.facts, mustNot: value.mustNot }
            : {
                question: value.question.trim(),
                outcome: value.outcome,
                facts: value.facts,
                mustNot: value.mustNot,
                mustPass: value.mustPass,
                ...(value.language ? { language: value.language } : {}),
              },
        );
      }}
    >
      <h4 className="ally-home__subhead">{title}</h4>
      {safety && <p className="ally-note">{t.lockedAdd}</p>}
      <div className="ally-field">
        <label htmlFor={`${id}-q`}>{t.editor.question}</label>
        <input
          id={`${id}-q`}
          className="ally-input"
          value={value.question}
          maxLength={500}
          disabled={safety}
          onChange={event => set({ question: event.target.value })}
        />
      </div>
      <fieldset className="ally-field" disabled={safety}>
        <legend className="ally-field__label">{t.editor.happen}</legend>
        <div className="ally-home__radios">
          {OUTCOMES.map(outcome => (
            <label
              key={outcome}
              className={`ally-home__radio${value.outcome === outcome ? " is-on" : ""}`}
            >
              <input
                type="radio"
                name={`${id}-outcome`}
                value={outcome}
                checked={value.outcome === outcome}
                onChange={() => set({ outcome })}
              />
              <span>{t.outcomes[outcome]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ChipsInput
        label={t.editor.includes}
        hint={t.editor.includesHint}
        value={value.facts}
        fixed={safety ? (initial.facts ?? []) : []}
        onChange={facts => set({ facts })}
      />
      <ChipsInput
        label={t.editor.mustNot}
        value={value.mustNot}
        fixed={safety ? (initial.mustNot ?? []) : []}
        onChange={mustNot => set({ mustNot })}
      />
      <div className="ally-checkup__editor-row">
        <label className="ally-home__check">
          <input
            type="checkbox"
            checked={value.mustPass}
            disabled={safety}
            aria-describedby={`${id}-mp`}
            onChange={event => set({ mustPass: event.target.checked })}
          />
          <span>{t.editor.mustPass}</span>
        </label>
        <span id={`${id}-mp`} className="ally-field__hint">
          {safety ? t.locked : t.editor.mustPassHint}
        </span>
      </div>
      <div className="ally-field">
        <label htmlFor={`${id}-lang`}>{t.editor.language}</label>
        <select
          id={`${id}-lang`}
          className="ally-input ally-input--compact"
          value={value.language}
          disabled={safety}
          onChange={event => set({ language: event.target.value })}
        >
          <option value="">{t.editor.languageAny}</option>
          <option value="en">{HOME.personality.languageOptions.en}</option>
          <option value="hi">{HOME.personality.languageOptions.hi}</option>
        </select>
      </div>
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      <div className="ally-btn-row">
        <Button type="submit" variant="primary" disabled={!ready || busy}>
          {t.editor.save}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t.editor.cancel}
        </Button>
      </div>
    </form>
  );
};
