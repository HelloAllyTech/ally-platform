import React, { useState } from "react";

import { Button } from "./core";

/** A "Found…" line with its accent tick popping in (DESIGN.md §4). */
export const FindingLine: React.FC<{ children: React.ReactNode; index?: number }> = ({
  children,
  index = 0,
}) => (
  <li className="ally-finding ally-rise" style={{ ["--ally-i" as string]: Math.min(index, 8) }}>
    <span className="ally-finding__tick ally-pop" aria-hidden="true">
      ✓
    </span>
    {children}
  </li>
);

/** Where a fact came from: a link chip to the page (new tab), or a plain chip ("From you"). */
export const SourceChip: React.FC<{ label: string; href?: string | null }> = ({ label, href }) =>
  href ? (
    <a className="ally-source" href={href} target="_blank" rel="noreferrer" title={href}>
      <span aria-hidden="true">↗</span>
      {label}
    </a>
  ) : (
    <span className="ally-source">{label}</span>
  );

export interface LearnedCardLabels {
  edit: string;
  remove: string;
  viewSource: string;
  save: string;
  cancel: string;
}

/**
 * One learned fact (DESIGN.md §4): the text, its SourceChip, and Edit (inline input) and Remove.
 * `onSave` and `onRemove` resolve false when the change was refused, which keeps the editor open.
 */
export const LearnedCard: React.FC<{
  text: string;
  source: { label: string; href?: string | null };
  labels: LearnedCardLabels;
  busy?: boolean;
  index?: number;
  onSave: (text: string) => Promise<boolean>;
  onRemove: () => void;
}> = ({ text, source, labels, busy = false, index = 0, onSave, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  return (
    <li className="ally-learned ally-rise" style={{ ["--ally-i" as string]: Math.min(index, 8) }}>
      {editing ? (
        <form
          className="ally-field"
          onSubmit={async event => {
            event.preventDefault();
            if (value.trim() && (await onSave(value.trim()))) setEditing(false);
          }}
        >
          <textarea
            className="ally-input"
            aria-label={labels.edit}
            value={value}
            autoFocus
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <div className="ally-btn-row">
            <Button type="submit" variant="primary" disabled={!value.trim() || busy}>
              {labels.save}
            </Button>
            <Button onClick={() => setEditing(false)}>{labels.cancel}</Button>
          </div>
        </form>
      ) : (
        <p className="ally-learned__text">{text}</p>
      )}
      <div className="ally-learned__meta">
        <SourceChip label={source.label} href={source.href} />
        {!editing && (
          <>
            <button
              type="button"
              className="ally-link"
              disabled={busy}
              onClick={() => {
                setValue(text);
                setEditing(true);
              }}
            >
              {labels.edit}
            </button>
            <button type="button" className="ally-link" disabled={busy} onClick={onRemove}>
              {labels.remove}
            </button>
          </>
        )}
      </div>
    </li>
  );
};

/** The safety pack (DESIGN.md §4): shield, "{Pack} is on", the always-on sentence, three panels. */
export const SafetyCard: React.FC<{
  title: string;
  body: string;
  panels: { always: string; never: string; atRisk: string };
  always: string[];
  never: string[];
  atRisk: string[];
}> = ({ title, body, panels, always, never, atRisk }) => {
  const panel = (label: string, items: string[], kind: string) =>
    items.length > 0 && (
      <section className={`ally-safety__panel ally-safety__panel--${kind}`}>
        <h3 className="ally-label" style={{ margin: 0 }}>
          {label}
        </h3>
        <ul>
          {items.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    );
  return (
    <div className="ally-safety ally-rise">
      <div className="ally-safety__head">
        <span className="ally-safety__shield" aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
            <path d="M8.5 12l2.5 2.5 4.5-5" />
          </svg>
        </span>
        <h2 className="ally-heading">{title}</h2>
      </div>
      <p className="ally-body" style={{ margin: 0 }}>
        {body}
      </p>
      <div className="ally-safety__panels">
        {panel(panels.always, always, "always")}
        {panel(panels.never, never, "never")}
        {panel(panels.atRisk, atRisk, "risk")}
      </div>
    </div>
  );
};

export interface DesignCardLabels {
  bestFor: string;
  will: string;
  wont: string;
  choose: string;
  comingSoon: string;
}

/** A design (DESIGN.md §4). The Coming soon variant is dimmed, with a badge and no button. */
export const DesignCard: React.FC<{
  title: string;
  bestFor?: string;
  will?: string[];
  wont?: string[];
  sample?: { from: string; text: string }[];
  body?: string;
  comingSoon?: boolean;
  chosen?: boolean;
  canChoose?: boolean;
  labels: DesignCardLabels;
  index?: number;
  onChoose?: () => void;
}> = ({
  title,
  bestFor,
  will = [],
  wont = [],
  sample = [],
  body,
  comingSoon,
  chosen,
  canChoose,
  labels,
  index = 0,
  onChoose,
}) => (
  <section
    className="ally-design ally-rise"
    data-soon={Boolean(comingSoon)}
    data-chosen={Boolean(chosen)}
    style={{ ["--ally-i" as string]: Math.min(index, 8) }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <h2 className="ally-design__title">{title}</h2>
      {comingSoon && <span className="ally-badge">{labels.comingSoon}</span>}
    </div>
    {comingSoon ? (
      <p className="ally-body" style={{ margin: 0 }}>
        {body}
      </p>
    ) : (
      <>
        {bestFor && (
          <p className="ally-small" style={{ margin: 0 }}>
            <strong>{labels.bestFor}</strong> {bestFor}
          </p>
        )}
        <div>
          <span className="ally-label">{labels.will}</span>
          <ul className="ally-design__will">
            {will.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        {wont.length > 0 && (
          <div>
            <span className="ally-label">{labels.wont}</span>
            <ul className="ally-design__wont">
              {wont.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {sample.length > 0 && (
          <div className="ally-design__sample">
            {sample.map((line, i) => (
              <p key={i} data-from={line.from}>
                {line.text}
              </p>
            ))}
          </div>
        )}
        {canChoose && onChoose && (
          <Button
            variant={chosen ? "primary" : "secondary"}
            onClick={onChoose}
            style={{ marginTop: "auto" }}
          >
            {labels.choose}
          </Button>
        )}
      </>
    )}
  </section>
);

/** Build steps (DESIGN.md §4): waiting circle → spinner → popped tick. */
export const BuildSteps: React.FC<{ steps: string[]; done: number }> = ({ steps, done }) => (
  <ol className="ally-build" aria-live="polite">
    {steps.map((label, i) => {
      const state = i < done ? "done" : i === done ? "active" : "waiting";
      return (
        <li key={label} data-state={state}>
          {state === "done" ? (
            <span className="ally-tick ally-pop" aria-hidden="true">
              ✓
            </span>
          ) : state === "active" ? (
            <span className="ally-spinner" aria-hidden="true" />
          ) : (
            <span className="ally-wait" aria-hidden="true" />
          )}
          <span>{label}</span>
        </li>
      );
    })}
  </ol>
);

/** A segmented single choice (Warm · Balanced · Formal; Light · Dark · Auto). */
export const Segmented = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="ally-segmented" role="radiogroup" aria-label={label}>
    {options.map(option => (
      <button
        key={option.id}
        type="button"
        role="radio"
        aria-checked={value === option.id}
        onClick={() => onChange(option.id)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/**
 * Colour swatches (chunk-20d §2): the first from the logo, then a few harmonious picks, then a
 * custom picker. Values are hex.
 */
export const ColourPicker: React.FC<{
  label: string;
  value: string;
  swatches: string[];
  customLabel: string;
  onChange: (hex: string) => void;
}> = ({ label, value, swatches, customLabel, onChange }) => (
  <div className="ally-swatches" role="radiogroup" aria-label={label}>
    {swatches.map(hex => (
      <button
        key={hex}
        type="button"
        role="radio"
        aria-checked={value.toLowerCase() === hex.toLowerCase()}
        aria-label={hex}
        className="ally-swatch ally-press"
        style={{ background: hex }}
        onClick={() => onChange(hex)}
      />
    ))}
    <label className="ally-swatch-custom" title={customLabel}>
      <span className="ally-sr-only">{customLabel}</span>
      <input type="color" value={value} onChange={event => onChange(event.target.value)} />
    </label>
  </div>
);
