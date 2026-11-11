import React, { useId, useState } from "react";

import { Button } from "@components/v2";

/**
 * The home's list pattern (chunk 20d-2): one row per entry with its words on the left and its
 * actions on the right, an "Add" row under the list, and one way to remove. Every list in the
 * home (who can open the page, WhatsApp's list, the team, documents, quick replies) uses it, so
 * they look and behave the same.
 */

export const ListRows: React.FC<{
  children: React.ReactNode;
  label: string;
  testId?: string;
}> = ({ children, label, testId }) => (
  <ul className="ally-list" aria-label={label} data-testid={testId}>
    {children}
  </ul>
);

export const ListRow: React.FC<{
  title: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, meta, badge, actions, children }) => (
  <li className="ally-list__row">
    <div className="ally-list__main">
      <span className="ally-list__title">
        {title}
        {badge}
      </span>
      {meta && <span className="ally-list__meta">{meta}</span>}
      {children}
    </div>
    {actions && <div className="ally-list__actions">{actions}</div>}
  </li>
);

/** Remove, as a small icon button whose name says what goes. */
export const RemoveButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ label, onClick, disabled }) => (
  <button
    type="button"
    className="ally-icon-btn"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
  >
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
      <path
        d="M5 5l10 10M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  </button>
);

/** An input and "Add" on one line; Enter adds too. Returns to empty once added. */
export const AddRow: React.FC<{
  label: string;
  placeholder?: string;
  addLabel: string;
  type?: string;
  disabled?: boolean;
  maxLength?: number;
  onAdd: (value: string) => Promise<boolean> | boolean;
  extra?: React.ReactNode;
}> = ({ label, placeholder, addLabel, type = "text", disabled, maxLength, onAdd, extra }) => {
  const id = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const clean = value.trim();
    if (!clean || busy) return;
    setBusy(true);
    const ok = await onAdd(clean);
    setBusy(false);
    if (ok) setValue("");
  };
  return (
    <div className="ally-add-row">
      <label htmlFor={id} className="ally-sr-only">
        {label}
      </label>
      <input
        id={id}
        className="ally-input"
        type={type}
        value={value}
        placeholder={placeholder ?? label}
        disabled={disabled}
        maxLength={maxLength}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            void add();
          }
        }}
      />
      {extra}
      <Button onClick={() => void add()} disabled={disabled || !value.trim() || busy}>
        {addLabel}
      </Button>
    </div>
  );
};

/** A confirm that sits in place of the row's actions (never a browser dialog). */
export const InlineConfirm: React.FC<{
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ question, confirmLabel, cancelLabel, onConfirm, onCancel }) => (
  <div className="ally-inline-confirm" role="group" aria-label={question}>
    <p className="ally-small">{question}</p>
    <div className="ally-btn-row">
      <Button className="ally-btn--danger" onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  </div>
);

/** A list's error, under it. */
export const ListError: React.FC<{ error: string | null }> = ({ error }) =>
  error ? (
    <p className="ally-error" role="alert">
      {error}
    </p>
  ) : null;

/** Rows at their final height while a list loads, so nothing below jumps. */
export const ListSkeleton: React.FC<{ rows?: number }> = ({ rows = 2 }) => (
  <ul className="ally-list" aria-hidden="true">
    {Array.from({ length: rows }, (_, n) => (
      <li key={n} className="ally-list__row ally-list__row--skeleton">
        <span className="ally-skeleton" />
      </li>
    ))}
  </ul>
);
