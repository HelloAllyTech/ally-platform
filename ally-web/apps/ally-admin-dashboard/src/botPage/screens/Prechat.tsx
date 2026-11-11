import { useEffect, useRef, useState } from "react";

// By path: the bot page imports only self-contained modules (see eslint.config.mjs).
import { isTypingTarget, optionKey } from "../../components/v2/core/keys";
import { AUTO_ADVANCE_MS } from "../../components/v2/core/Option";
import {
  ErrorText,
  PageHeader,
  PrimaryButton,
  ScreenHeading,
  TextButton,
} from "../components/parts";
import { fill, type BotPageCopy } from "../copy";

import type { BotPageBranding, PrechatField } from "../types";

/**
 * The pre-chat questions, one per screen (screenshots 02-bot-page-02/03): each slides in, with a
 * progress bar. A choice is a lettered option; picking one (click or its letter) moves on after
 * 380 ms, except on the last question, which waits for "Start chatting".
 */
export function Prechat({
  branding,
  copy,
  fields,
  onDone,
  busy = false,
  error,
  errorField,
}: {
  branding: BotPageBranding;
  copy: BotPageCopy;
  fields: PrechatField[];
  onDone(answers: { id: string; value: string }[]): void;
  busy?: boolean;
  error?: string | null;
  /** The question the server refused, to go back to it. */
  errorField?: string | null;
}) {
  const [index, setIndex] = useState(() => {
    const refused = fields.findIndex(f => f.id === errorField);
    return refused >= 0 ? refused : 0;
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const field = fields[index];
  const value = answers[field.id] ?? "";
  const last = index === fields.length - 1;

  const set = (next: string) => {
    setMissing(false);
    setAnswers(a => ({ ...a, [field.id]: next }));
  };

  const advance = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(advance.current), []);
  const choose = (option: string) => {
    set(option);
    if (last) return;
    clearTimeout(advance.current);
    advance.current = setTimeout(() => setIndex(i => i + 1), AUTO_ADVANCE_MS);
  };
  // Letter keys pick a choice while a choice question is on screen.
  useEffect(() => {
    if (field.type !== "choice") return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target) && target?.getAttribute("type") !== "radio") return;
      const option = (field.options ?? [])[event.key.toUpperCase().charCodeAt(0) - 65];
      if (option) {
        event.preventDefault();
        choose(option);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const next = (event: React.FormEvent) => {
    event.preventDefault();
    if (field.required && !value.trim()) {
      setMissing(true);
      return;
    }
    if (!last) {
      setIndex(index + 1);
      return;
    }
    onDone(fields.map(f => ({ id: f.id, value: answers[f.id] ?? "" })));
  };

  const inputId = `bp-q-${field.id}`;
  return (
    <div className="bp-screen">
      <PageHeader branding={branding} />
      <form
        key={field.id}
        onSubmit={next}
        className="bp-pad bp-stack bp-grow ally-slide"
        noValidate
      >
        <div className="bp-progress-row">
          <div
            className="ally-progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={fields.length}
            aria-valuenow={index + 1}
            aria-label={fill(copy.prechat.progress, { n: index + 1, total: fields.length })}
          >
            <div
              className="ally-progress__bar"
              style={{ width: `${((index + 1) / fields.length) * 100}%` }}
            />
          </div>
          <span className="bp-small">
            {fill(copy.prechat.progress, { n: index + 1, total: fields.length })}
          </span>
        </div>
        {field.type === "choice" ? (
          <fieldset
            className="bp-stack"
            style={{ border: 0, margin: 0, padding: 0 }}
            aria-labelledby={`${inputId}-label`}
          >
            <ScreenHeading id={`${inputId}-label`}>{field.label}</ScreenHeading>
            {!field.required && <p className="bp-small">{copy.prechat.optional}</p>}
            <div className="bp-stack" style={{ gap: 10 }}>
              {(field.options ?? []).map((option, i) => (
                <label key={option} htmlFor={`${inputId}-${i}`} className="bp-choice ally-press">
                  <input
                    id={`${inputId}-${i}`}
                    aria-labelledby={`${inputId}-${i}-text`}
                    type="radio"
                    name={inputId}
                    value={option}
                    checked={value === option}
                    onChange={() => choose(option)}
                  />
                  <span className="ally-kbd" aria-hidden="true">
                    {optionKey(i)}
                  </span>
                  <span id={`${inputId}-${i}-text`} style={{ flex: 1 }}>
                    {option}
                  </span>
                  {value === option && (
                    <span
                      className="ally-pop"
                      aria-hidden="true"
                      style={{ color: "var(--brand-accent)" }}
                    >
                      ✓
                    </span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ) : field.type === "consent" ? (
          <>
            <ScreenHeading id={`${inputId}-label`}>{field.label}</ScreenHeading>
            {field.consentText && (
              <p className="ally-body" style={{ margin: 0, whiteSpace: "pre-line" }}>
                {field.consentText}
              </p>
            )}
            <label className="bp-check">
              <input
                type="checkbox"
                checked={value === "true"}
                onChange={e => set(e.target.checked ? "true" : "")}
              />
              <span style={{ fontWeight: 600 }}>{copy.prechat.agree}</span>
            </label>
          </>
        ) : (
          <>
            <ScreenHeading id={`${inputId}-label`}>{field.label}</ScreenHeading>
            {!field.required && <p className="bp-small">{copy.prechat.optional}</p>}
            <input
              id={inputId}
              type={
                field.type === "email"
                  ? "email"
                  : field.type === "phone"
                    ? "tel"
                    : field.type === "date"
                      ? "date"
                      : "text"
              }
              inputMode={
                field.type === "phone" ? "tel" : field.type === "email" ? "email" : undefined
              }
              autoComplete={
                field.type === "email" ? "email" : field.type === "phone" ? "tel" : "off"
              }
              value={value}
              onChange={e => set(e.target.value)}
              maxLength={500}
              aria-labelledby={`${inputId}-label`}
              aria-invalid={missing || undefined}
              className="ally-input"
            />
          </>
        )}
        {missing && (
          <p className="bp-error" role="alert">
            {copy.prechat.required}
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="bp-actions">
          {index > 0 ? (
            <TextButton onClick={() => setIndex(index - 1)} disabled={busy}>
              {copy.prechat.back}
            </TextButton>
          ) : (
            <span />
          )}
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? copy.loading : last ? copy.prechat.finish : copy.prechat.next}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
