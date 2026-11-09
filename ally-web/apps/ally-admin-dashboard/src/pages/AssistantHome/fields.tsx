import React, { useId } from "react";

import { Button } from "@components/v2";

import type { HomeField } from "./useHomeField";

/** A section's heading and its one line (copy §20). */
export const SectionHead: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <header className="ally-home__section-head">
    <h2 className="ally-heading" tabIndex={-1} data-section-heading>
      {title}
    </h2>
    <p className="ally-small">{subtitle}</p>
  </header>
);

/** A card holding related fields, with an optional title and hint. */
export const Group: React.FC<{
  title?: string;
  hint?: string;
  children: React.ReactNode;
  testId?: string;
}> = ({ title, hint, children, testId }) => (
  <section className="ally-card ally-home__group" data-testid={testId}>
    {title && <h3 className="ally-home__group-title">{title}</h3>}
    {hint && <p className="ally-field__hint ally-home__group-hint">{hint}</p>}
    {children}
  </section>
);

const FieldError: React.FC<{ id: string; error: string | null }> = ({ id, error }) =>
  error ? (
    <p id={id} className="ally-error" role="alert">
      {error}
    </p>
  ) : null;

/** One text field that saves itself: on a pause in typing, and when it loses focus. */
export const TextField: React.FC<{
  label: string;
  hint?: string;
  field: HomeField<string>;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}> = ({ label, hint, field, disabled, multiline, rows = 3, placeholder, maxLength }) => {
  const id = useId();
  const props = {
    id,
    className: "ally-input",
    value: field.value,
    disabled,
    placeholder,
    maxLength,
    "aria-invalid": field.error ? true : undefined,
    "aria-describedby":
      [hint && `${id}-hint`, field.error && `${id}-error`].filter(Boolean).join(" ") || undefined,
    onBlur: field.flush,
  };
  return (
    <div className="ally-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={`${id}-hint`} className="ally-field__hint">
          {hint}
        </span>
      )}
      {multiline ? (
        <textarea {...props} rows={rows} onChange={event => field.set(event.target.value)} />
      ) : (
        <input {...props} onChange={event => field.set(event.target.value)} />
      )}
      <FieldError id={`${id}-error`} error={field.error} />
    </div>
  );
};

/** A short list of lines (suggested questions): edit, remove, add, up to `max`. */
export const LinesField: React.FC<{
  label: string;
  hint?: string;
  addLabel: string;
  removeLabel: string;
  field: HomeField<string[]>;
  max: number;
  disabled?: boolean;
  maxLength?: number;
}> = ({ label, hint, addLabel, removeLabel, field, max, disabled, maxLength }) => {
  const id = useId();
  const lines = field.value;
  const update = (next: string[], now = false) => field.set(next, { now });
  return (
    <fieldset
      className="ally-field ally-home__lines"
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      <legend className="ally-field__label">{label}</legend>
      {hint && (
        <span id={`${id}-hint`} className="ally-field__hint">
          {hint}
        </span>
      )}
      {lines.map((line, index) => (
        <div className="ally-home__line" key={index}>
          <input
            className="ally-input"
            aria-label={`${label} ${index + 1}`}
            value={line}
            disabled={disabled}
            maxLength={maxLength}
            onChange={event => update(lines.map((l, n) => (n === index ? event.target.value : l)))}
            onBlur={() => {
              // An emptied line goes when the owner moves on.
              if (!line.trim())
                update(
                  lines.filter((_, n) => n !== index),
                  true,
                );
              else field.flush();
            }}
          />
          {!disabled && (
            <button
              type="button"
              className="ally-link"
              aria-label={`${removeLabel}: ${line || `${label} ${index + 1}`}`}
              onClick={() =>
                update(
                  lines.filter((_, n) => n !== index),
                  true,
                )
              }
            >
              {removeLabel}
            </button>
          )}
        </div>
      ))}
      {!disabled && lines.length < max && (
        <div>
          <Button onClick={() => update([...lines, ""])}>{addLabel}</Button>
        </div>
      )}
      <FieldError id={`${id}-error`} error={field.error} />
    </fieldset>
  );
};

/** A collapsed group (Extra instructions): closed until the owner opens it. */
export const Collapsed: React.FC<{ summary: string; children: React.ReactNode }> = ({
  summary,
  children,
}) => (
  <details className="ally-home__details">
    <summary>{summary}</summary>
    <div className="ally-home__details-body">{children}</div>
  </details>
);
