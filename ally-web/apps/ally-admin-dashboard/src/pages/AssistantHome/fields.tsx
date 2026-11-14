import React, { useEffect, useId, useState } from "react";

import { Button } from "@components/v2";

import { HOME, fill } from "./copy";
import { HelpToggle } from "./ui/Help";
import { RemoveButton } from "./ui/List";

import type { HomeField } from "./useHomeField";

/**
 * A section's heading, its one line saying what it is (copy §20), and its `?` with a short
 * explainer (chunk 20d-2). `action` sits on the heading's line (Checkup's Run again).
 */
export const SectionHead: React.FC<{
  title: string;
  subtitle: string;
  help?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, help, action }) => (
  <header className="ally-home__section-head">
    <div className="ally-home__section-title">
      <h2 className="ally-heading" tabIndex={-1} data-section-heading>
        {title}
      </h2>
      {help && (
        <HelpToggle label={fill(HOME.help.label, { section: title })}>
          <p className="ally-small">{help}</p>
        </HelpToggle>
      )}
      {action && <div className="ally-home__section-action">{action}</div>}
    </div>
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

/**
 * A list being edited, where some items aren't finished yet (a question with no words). They stay
 * on screen but aren't saved until they're ready; only the ready ones are sent. A new list from the
 * server (Undo, another tab) replaces what's shown unless it's just the ready part of it.
 */
export const useDraftList = <T,>(
  field: HomeField<T[]>,
  ready: (item: T) => boolean,
): [T[], (next: T[], now?: boolean) => void] => {
  const [items, setItems] = useState(field.value);
  const saved = JSON.stringify(field.value);
  useEffect(() => {
    setItems(current =>
      JSON.stringify(current.filter(ready)) === saved ? current : (JSON.parse(saved) as T[]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  const update = (next: T[], now = false) => {
    setItems(next);
    field.set(next.filter(ready), { now });
  };
  return [items, update];
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
  const [lines, update] = useDraftList(field, line => line.trim() !== "");
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
            // A line just added is ready for its words.
            autoFocus={line === "" && index === lines.length - 1}
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
            <RemoveButton
              label={`${removeLabel}: ${line || `${label} ${index + 1}`}`}
              onClick={() =>
                update(
                  lines.filter((_, n) => n !== index),
                  true,
                )
              }
            />
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

/**
 * A group card that opens and closes (Lists' Details, Rules and What your assistant can do, chunk
 * 5b): the home's group, with its title as a real button, so it isn't a native `<details>`.
 */
export const CollapsibleGroup: React.FC<{
  title: string;
  hint?: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  testId?: string;
}> = ({ title, hint, summary, defaultOpen = false, children, testId }) => {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ally-card ally-home__group ally-collapsible" data-testid={testId}>
      <h3 className="ally-home__group-title">
        <button
          type="button"
          className="ally-collapsible__toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen(o => !o)}
        >
          <span className="ally-collapsible__title">{title}</span>
          {summary && !open && <span className="ally-collapsible__summary">{summary}</span>}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            width="18"
            height="18"
            className="ally-collapsible__chevron"
          >
            <path
              d="M5 8l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open} className="ally-collapsible__body">
        {hint && <p className="ally-field__hint">{hint}</p>}
        {open && children}
      </div>
    </section>
  );
};
