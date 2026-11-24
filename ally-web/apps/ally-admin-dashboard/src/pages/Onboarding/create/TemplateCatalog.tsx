import React, { useState } from "react";

import { useGetBotTemplatesQuery } from "@api";
import type { BotTemplateCard, BotTemplateField } from "@api";
import { Button } from "@components/v2";

import { BUILD_COPY } from "./copy";
import { fill } from "../copy";

const T = BUILD_COPY.templates;

type Answer = string | boolean | string[];

const FieldInput: React.FC<{
  field: BotTemplateField;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
}> = ({ field, value, onChange }) => {
  const id = `tpl-${field.key}`;
  if (field.kind === "yes_no") {
    return (
      <fieldset className="ally-field ally-build__choices">
        <legend className="ally-field__label">{field.label}</legend>
        {field.hint && <p className="ally-small">{field.hint}</p>}
        {[true, false].map(v => (
          <label key={String(v)} className="ally-build__choice">
            <input type="radio" name={id} checked={value === v} onChange={() => onChange(v)} />
            <span>{v ? T.yes : T.no}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (field.kind === "choices" && field.choices?.length) {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="ally-field ally-build__choices">
        <legend className="ally-field__label">{field.label}</legend>
        {field.hint && <p className="ally-small">{field.hint}</p>}
        {field.choices.map(choice => (
          <label key={choice} className="ally-build__choice">
            <input
              type="checkbox"
              checked={picked.includes(choice)}
              onChange={() =>
                onChange(
                  picked.includes(choice) ? picked.filter(c => c !== choice) : [...picked, choice],
                )
              }
            />
            <span>{choice}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <div className="ally-field">
      <label className="ally-field__label" htmlFor={id}>
        {field.label}
      </label>
      {field.hint && <p className="ally-small">{field.hint}</p>}
      {field.kind === "long_text" || field.kind === "choices" ? (
        <textarea
          id={id}
          className="ally-input"
          rows={3}
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="ally-input"
          value={typeof value === "string" ? value : ""}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
};

/**
 * Pick a template: Ally's template chatbots (`GET /v1/bot-templates`), each one's setup questions
 * as form fields. Applying works at $0 (Ally pays to index its knowledge, R4).
 */
export const TemplateCatalog: React.FC<{
  busy: boolean;
  problem: string | null;
  onApply: (template: BotTemplateCard, answers: Record<string, Answer>) => void;
  onBack: () => void;
}> = ({ busy, problem, onApply, onBack }) => {
  const catalogue = useGetBotTemplatesQuery();
  const [chosen, setChosen] = useState<BotTemplateCard | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [missing, setMissing] = useState(false);

  if (chosen) {
    return (
      <form
        className="ally-build__template"
        data-testid="template-setup"
        onSubmit={event => {
          event.preventDefault();
          const lacking = chosen.fields.some(
            f =>
              f.required && !(typeof answers[f.key] === "string" && String(answers[f.key]).trim()),
          );
          setMissing(lacking);
          if (!lacking) onApply(chosen, answers);
        }}
      >
        <Button variant="ghost" onClick={() => setChosen(null)}>
          {T.back}
        </Button>
        <h3 className="ally-heading">{chosen.name}</h3>
        <p className="ally-small">{chosen.oneLiner}</p>
        {chosen.fields.map(field => (
          <FieldInput
            key={field.key}
            field={field}
            value={answers[field.key]}
            onChange={value => setAnswers(a => ({ ...a, [field.key]: value }))}
          />
        ))}
        {missing && (
          <p className="ally-error" role="alert">
            {T.required}
          </p>
        )}
        {problem && (
          <p className="ally-error" role="alert">
            {problem}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? T.applying : T.apply}
        </Button>
      </form>
    );
  }

  return (
    <div className="ally-build__templates" data-testid="template-catalog">
      <Button variant="ghost" onClick={onBack}>
        {BUILD_COPY.start.back}
      </Button>
      <h3 className="ally-heading">{T.heading}</h3>
      {catalogue.isLoading && <p className="ally-small">{T.loading}</p>}
      {catalogue.isError && (
        <p className="ally-error" role="alert">
          {T.failed}{" "}
          <button type="button" className="ally-link" onClick={() => void catalogue.refetch()}>
            {BUILD_COPY.retry}
          </button>
        </p>
      )}
      <ul className="ally-build__cards">
        {(catalogue.data?.templates ?? []).map(t => (
          <li key={t.id}>
            <button
              type="button"
              className="ally-option ally-press"
              data-testid={`template-${t.id}`}
              onClick={() => {
                setChosen(t);
                setAnswers({});
              }}
            >
              <span className="ally-option__text">
                <strong>{t.name}</strong>
                <span className="ally-small"> {t.oneLiner}</span>
                {t.documents.length > 0 && (
                  <span className="ally-small">
                    {" "}
                    · {fill(T.documents, { n: t.documents.length })}
                  </span>
                )}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
