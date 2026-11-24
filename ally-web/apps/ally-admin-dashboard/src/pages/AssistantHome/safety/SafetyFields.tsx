import React, { useId, useState } from "react";

import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";

import { SAFETY_DEFAULTS, SAFETY_LIMITS } from "./useSafetySettings";
import { SAFETY_PRIVACY_COPY as C } from "../copy/safetyPrivacy";

import type { HumanContact, SafetyValues } from "./useSafetySettings";

type Save = (patch: Partial<Record<keyof SafetyValues, unknown>>) => Promise<string | null>;

const Problem: React.FC<{ text: string | null; id?: string }> = ({ text, id }) =>
  text ? (
    <p className="ally-error" role="alert" id={id}>
      {text}
    </p>
  ) : null;

/** Who will use it: adults only or people who may be under 18. Saves at once. */
export const AudienceAgeField: React.FC<{
  value?: string;
  disabled: boolean;
  save: Save;
  /** Why go-live asked for it (a 409's missing item), shown beside the field. */
  missing?: string | null;
}> = ({ value, disabled, save, missing }) => {
  const [problem, setProblem] = useState<string | null>(null);
  const name = useId();
  const current = value ?? SAFETY_DEFAULTS.audienceAge;
  return (
    <fieldset className="ally-build__choices" disabled={disabled} data-testid="safety-audience">
      <legend className="ally-field__label">{C.audience.label}</legend>
      {(["adults", "includes_minors"] as const).map(id => (
        <label key={id} className="ally-build__choice">
          <Input
            className="!h-4 !w-4"
            type="radio"
            name={name}
            checked={current === id}
            onChange={() => void save({ audienceAge: id }).then(setProblem)}
          />
          <span>{C.audience[id]}</span>
        </label>
      ))}
      {current === "unstated" && <p className="ally-small">{C.audience.unstated}</p>}
      <Problem text={problem ?? missing ?? null} />
    </fieldset>
  );
};

/** How a customer reaches a person: phone, email and web page; at least one. */
export const HumanContactField: React.FC<{
  value?: HumanContact;
  disabled: boolean;
  save: Save;
  missing?: string | null;
}> = ({ value, disabled, save, missing }) => {
  const [draft, setDraft] = useState<HumanContact>(value ?? {});
  const stamp = JSON.stringify(value ?? {});
  const [seen, setSeen] = useState(stamp);
  if (seen !== stamp) {
    setSeen(stamp);
    setDraft(value ?? {});
  }
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const id = useId();
  const keys = ["phone", "email", "url"] as const;
  return (
    <div className="ally-field" data-testid="safety-contact">
      <span className="ally-field__label">{C.contact.label}</span>
      <span className="ally-field__hint">{C.contact.hint}</span>
      {keys.map(key => (
        <label key={key} className="ally-field" htmlFor={`${id}-${key}`}>
          <span className="ally-small">{C.contact[key]}</span>
          <Input
            id={`${id}-${key}`}
            className="!w-full"
            value={draft[key] ?? ""}
            disabled={disabled}
            onChange={e => {
              setDone(false);
              setDraft({ ...draft, [key]: e.target.value });
            }}
          />
        </label>
      ))}
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          type="button"
          disabled={disabled}
          onClick={async () => {
            setDone(false);
            const clean = Object.fromEntries(
              keys.map(k => [k, (draft[k] ?? "").trim()]).filter(([, v]) => v),
            );
            const reason = await save({ humanContact: clean });
            setProblem(reason);
            setDone(!reason);
          }}
        >
          {C.contact.save}
        </Button>
      </div>
      {done && (
        <p className="ally-small" role="status">
          {C.saved}
        </p>
      )}
      <Problem text={problem ?? missing ?? null} />
    </div>
  );
};

/** A whole number from min to max, saved when the box is left. The backend's refusal shows. */
const NumberField: React.FC<{
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  field: keyof SafetyValues;
  disabled: boolean;
  save: Save;
}> = ({ label, hint, value, min, max, field, disabled, save }) => {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [problem, setProblem] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  return (
    <div className="ally-field">
      <label className="ally-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="ally-field__hint">{hint}</span>
      <Input
        id={id}
        className="!w-full"
        type="number"
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        onChange={e => setText(e.target.value)}
        onBlur={async () => {
          if (text.trim() === String(value)) return;
          const reason = await save({ [field]: Number(text) });
          setProblem(reason);
          if (reason) setText(String(value));
        }}
      />
      <Problem text={problem} />
    </div>
  );
};

const ChoiceField: React.FC<{
  label: string;
  value: string;
  options: Record<string, string>;
  field: keyof SafetyValues;
  disabled: boolean;
  save: Save;
}> = ({ label, value, options, field, disabled, save }) => {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="ally-field">
      <label className="ally-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="ally-input"
        value={value}
        disabled={disabled}
        onChange={e => void save({ [field]: e.target.value }).then(setProblem)}
      >
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
      <Problem text={problem} />
    </div>
  );
};

const AlertPolicyField: React.FC<{
  value?: SafetyValues["alertPolicy"];
  disabled: boolean;
  save: Save;
}> = ({ value, disabled, save }) => {
  const policy = value ?? SAFETY_DEFAULTS.alertPolicy;
  const [text, setText] = useState((policy.recipients ?? []).join("\n"));
  const [problem, setProblem] = useState<string | null>(null);
  const name = useId();
  const recipients = () =>
    text
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
  const write = async (mode: "immediate" | "digest") => {
    const list = recipients();
    setProblem(await save({ alertPolicy: { mode, ...(list.length ? { recipients: list } : {}) } }));
  };
  return (
    <fieldset className="ally-build__choices" disabled={disabled} data-testid="safety-alerts">
      <legend className="ally-field__label">{C.alerts.label}</legend>
      <p className="ally-small">{C.alerts.hint}</p>
      {(["immediate", "digest"] as const).map(mode => (
        <label key={mode} className="ally-build__choice">
          <Input
            className="!h-4 !w-4"
            type="radio"
            name={name}
            checked={policy.mode === mode}
            onChange={() => void write(mode)}
          />
          <span>{C.alerts[mode]}</span>
        </label>
      ))}
      <label className="ally-field">
        <span className="ally-small">{C.alerts.recipients}</span>
        <textarea
          className="ally-input"
          rows={2}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </label>
      <p className="ally-small">{C.alerts.recipientsHint}</p>
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          type="button"
          onClick={() => void write(policy.mode)}
        >
          {C.alerts.save}
        </Button>
      </div>
      <Problem text={problem} />
    </fieldset>
  );
};

const TimeZoneField: React.FC<{ value: string; disabled: boolean; save: Save }> = ({
  value,
  disabled,
  save,
}) => {
  const id = useId();
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  return (
    <div className="ally-field">
      <label className="ally-field__label" htmlFor={id}>
        {C.timeZone.label}
      </label>
      <span className="ally-field__hint">{C.timeZone.hint}</span>
      <Input
        id={id}
        className="!w-full"
        value={text}
        disabled={disabled}
        onChange={e => setText(e.target.value)}
        onBlur={async () => {
          if (text.trim() === value) return;
          const reason = await save({ timeZone: text.trim() });
          setProblem(reason);
          if (reason) setText(value);
        }}
      />
      <Problem text={problem} />
    </div>
  );
};

/** The rest of "Safety and privacy": everything except audience and contact (used in Settings). */
export const SafetyPrivacyFields: React.FC<{
  values: SafetyValues;
  disabled: boolean;
  save: Save;
}> = ({ values, disabled, save }) => (
  <>
    <AudienceAgeField value={values.audienceAge} disabled={disabled} save={save} />
    <HumanContactField value={values.humanContact} disabled={disabled} save={save} />
    <NumberField
      label={C.retention.label}
      hint={C.retention.hint}
      value={values.retentionDays ?? SAFETY_DEFAULTS.retentionDays}
      {...SAFETY_LIMITS.retentionDays}
      field="retentionDays"
      disabled={disabled}
      save={save}
    />
    <ChoiceField
      label={C.noAnswer.label}
      value={values.noAnswerMode ?? SAFETY_DEFAULTS.noAnswerMode}
      options={{
        say_unknown_offer_person: C.noAnswer.say_unknown_offer_person,
        say_unknown: C.noAnswer.say_unknown,
        offer_person: C.noAnswer.offer_person,
      }}
      field="noAnswerMode"
      disabled={disabled}
      save={save}
    />
    <AlertPolicyField value={values.alertPolicy} disabled={disabled} save={save} />
    <NumberField
      label={C.wait.label}
      hint={C.wait.hint}
      value={
        values.waitBeforeNoOneAvailableMinutes ?? SAFETY_DEFAULTS.waitBeforeNoOneAvailableMinutes
      }
      {...SAFETY_LIMITS.waitBeforeNoOneAvailableMinutes}
      field="waitBeforeNoOneAvailableMinutes"
      disabled={disabled}
      save={save}
    />
    <ChoiceField
      label={C.resume.label}
      value={values.crisisResumeRule ?? SAFETY_DEFAULTS.crisisResumeRule}
      options={{ never: C.resume.never, after_idle: C.resume.after_idle }}
      field="crisisResumeRule"
      disabled={disabled}
      save={save}
    />
    <TimeZoneField
      value={values.timeZone ?? SAFETY_DEFAULTS.timeZone}
      disabled={disabled}
      save={save}
    />
  </>
);
