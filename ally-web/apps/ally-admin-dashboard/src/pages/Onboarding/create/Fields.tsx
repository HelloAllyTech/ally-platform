import React, { useEffect, useId, useRef, useState } from "react";

import { Button } from "@components/v2";

import { SAFETY_PRIVACY_COPY } from "../../AssistantHome/copy/safetyPrivacy";
import { BUILD_COPY } from "./copy";
import { LANGUAGE_IDS, TONE_IDS, asList, asText, linesOf, sameValue } from "./logic";

import type { WorkingCopy } from "./useWorkingCopy";

const F = BUILD_COPY.field;
const T = BUILD_COPY.form;

export interface FieldCommon {
  name: string;
  label: string;
  hint?: string;
  copy: WorkingCopy;
  /** Disabled (read-only, or needs credits). */
  disabled?: boolean;
  /** Shown instead of the hint when the field is disabled for credits. */
  disabledReason?: string | null;
  /** "From template" tag. */
  fromTemplate?: boolean;
  /** Why Apply left this field out (beside the field, the text kept). */
  applyReason?: string | null;
}

/** A field's status line: saving, saved, and every way an edit can be "not applied". */
const Status: React.FC<{ name: string; copy: WorkingCopy; applyReason?: string | null }> = ({
  name,
  copy,
  applyReason,
}) => {
  const f = copy.field(name);
  const o = f.outcome;
  if (o.status === "stale") {
    return (
      <div
        className="ally-build__status ally-build__status--bad"
        role="alert"
        data-testid={`field-stale-${name}`}
      >
        <span>
          <strong>{F.notApplied}.</strong> {F.stale}
        </span>
        <Button variant="ghost" onClick={() => copy.reload(name)}>
          {F.reload}
        </Button>
        <Button variant="secondary" onClick={() => void copy.overwrite(name)}>
          {F.overwrite}
        </Button>
      </div>
    );
  }
  if (o.status === "refused" || o.status === "credits" || o.status === "failed") {
    const text =
      o.status === "credits" ? F.credits : o.status === "failed" ? F.failed : o.reason || F.refused;
    return (
      <div
        className="ally-build__status ally-build__status--bad"
        role="alert"
        data-testid={`field-refused-${name}`}
      >
        <span>
          <strong>{F.notApplied}.</strong> {text}
        </span>
        {o.status === "failed" && (
          <Button variant="ghost" onClick={() => void copy.commit(name, f.value)}>
            {F.retry}
          </Button>
        )}
      </div>
    );
  }
  if (applyReason) {
    return (
      <p className="ally-build__status ally-build__status--bad ally-small" role="alert">
        <strong>{F.notApplied}.</strong> {applyReason}
      </p>
    );
  }
  if (o.status === "saving") return <p className="ally-build__status ally-small">{F.saving}</p>;
  if (o.status === "saved") {
    return <p className="ally-build__status ally-small">{copy.live ? F.savedLive : F.saved}</p>;
  }
  return null;
};

const Shell: React.FC<FieldCommon & { id: string; children: React.ReactNode; group?: boolean }> = ({
  id,
  name,
  label,
  hint,
  copy,
  disabled,
  disabledReason,
  fromTemplate,
  applyReason,
  children,
  group,
}) => (
  <div className="ally-field ally-build__field" data-field={name}>
    {group ? (
      <span className="ally-field__label" id={`${id}-label`}>
        {label}
        {fromTemplate && (
          <span className="ally-build__tag">{BUILD_COPY.templates.fromTemplate}</span>
        )}
      </span>
    ) : (
      <label className="ally-field__label" htmlFor={id}>
        {label}
        {fromTemplate && (
          <span className="ally-build__tag">{BUILD_COPY.templates.fromTemplate}</span>
        )}
      </label>
    )}
    {disabled && disabledReason ? (
      <p className="ally-small">{disabledReason}</p>
    ) : hint ? (
      <p className="ally-small">{hint}</p>
    ) : null}
    {children}
    <Status name={name} copy={copy} applyReason={applyReason} />
  </div>
);

/** A text field: shown as typed, sent after a pause or on leaving it. */
export const TextInput: React.FC<
  FieldCommon & { multiline?: boolean; maxLength?: number }
> = props => {
  const id = useId();
  const { name, copy, disabled, multiline, maxLength } = props;
  const value = asText(copy.field(name).value);
  const common = {
    id,
    className: "ally-input",
    value,
    disabled,
    maxLength,
    "data-testid": `field-${name}`,
    onBlur: () => void copy.commit(name),
  };
  return (
    <Shell {...props} id={id}>
      {multiline ? (
        <textarea {...common} rows={4} onChange={e => copy.type(name, e.target.value)} />
      ) : (
        <input {...common} onChange={e => copy.type(name, e.target.value)} />
      )}
    </Shell>
  );
};

/** A list, one item per line. The box keeps the raw text while focused; the server gets the list. */
export const LinesInput: React.FC<FieldCommon> = props => {
  const id = useId();
  const { name, copy, disabled } = props;
  const list = asList(copy.field(name).value);
  const [raw, setRaw] = useState(list.join("\n"));
  const focused = useRef(false);
  // Follow the working copy (a Copilot change, Reload) unless the builder is typing here.
  useEffect(() => {
    if (!focused.current && !sameValue(linesOf(raw), list)) setRaw(list.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(list)]);
  return (
    <Shell {...props} id={id}>
      <textarea
        id={id}
        className="ally-input"
        rows={4}
        value={raw}
        disabled={disabled}
        data-testid={`field-${name}`}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={e => {
          setRaw(e.target.value);
          copy.type(name, linesOf(e.target.value));
        }}
        onBlur={() => {
          focused.current = false;
          void copy.commit(name, linesOf(raw));
        }}
      />
    </Shell>
  );
};

/** The tone: a short list, sent at once. */
export const ToneInput: React.FC<FieldCommon> = props => {
  const id = useId();
  const { name, copy, disabled } = props;
  const value = asText(copy.field(name).value);
  return (
    <Shell {...props} id={id} group>
      <div className="ally-build__choices" role="radiogroup" aria-labelledby={`${id}-label`}>
        {TONE_IDS.map(tone => (
          <label key={tone} className="ally-build__choice">
            <input
              type="radio"
              name={`${id}-tone`}
              value={tone}
              checked={value === tone}
              disabled={disabled}
              onChange={() => void copy.commit(name, tone)}
            />
            <span>{T.tones[tone]}</span>
          </label>
        ))}
      </div>
    </Shell>
  );
};

/** Languages: several at once, at least one. */
export const LanguagesInput: React.FC<FieldCommon> = props => {
  const id = useId();
  const { name, copy, disabled } = props;
  const value = asList(copy.field(name).value);
  const known = [
    ...LANGUAGE_IDS,
    ...value.filter(v => !(LANGUAGE_IDS as readonly string[]).includes(v)),
  ];
  return (
    <Shell {...props} id={id} group>
      <div className="ally-build__choices" role="group" aria-labelledby={`${id}-label`}>
        {known.map(tag => {
          const on = value.includes(tag);
          const last = on && value.length === 1;
          return (
            <label
              key={tag}
              className="ally-build__choice"
              title={last ? T.oneLanguage : undefined}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={disabled || last}
                onChange={() =>
                  void copy.commit(name, on ? value.filter(v => v !== tag) : [...value, tag])
                }
              />
              <span>{T.languageNames[tag] ?? tag}</span>
            </label>
          );
        })}
      </div>
    </Shell>
  );
};

const P = SAFETY_PRIVACY_COPY.goLive;

/** What the chatbot is for (a go-live item): a short list sent at once, and a note for "something else". */
export const PurposeInput: React.FC<FieldCommon> = props => {
  const id = useId();
  const { name, copy, disabled } = props;
  const value = asText(copy.field(name).value);
  const note = asText(copy.field("purposeNote").value);
  return (
    <Shell {...props} id={id} group>
      <div className="ally-build__choices" role="radiogroup" aria-labelledby={`${id}-label`}>
        {Object.entries(P.purposes).map(([purpose, label]) => (
          <label key={purpose} className="ally-build__choice">
            <input
              type="radio"
              name={`${id}-purpose`}
              value={purpose}
              checked={value === purpose}
              disabled={disabled}
              onChange={() => void copy.commit(name, purpose)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {value === "custom" && (
        <input
          className="ally-input"
          aria-label={P.purposeNote}
          placeholder={P.purposeNote}
          value={note}
          disabled={disabled}
          maxLength={300}
          data-testid="field-purposeNote"
          onChange={e => copy.type("purposeNote", e.target.value)}
          onBlur={() => void copy.commit("purposeNote")}
        />
      )}
    </Shell>
  );
};
