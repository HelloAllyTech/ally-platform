import { useState } from "react";

import {
  ErrorText,
  PageHeader,
  PrimaryButton,
  ScreenHeading,
  TextButton,
} from "../components/parts";
import { fill, type BotPageCopy } from "../copy";

import type { BotPageBranding, PrechatField } from "../types";

const inputClass =
  "mt-2 min-h-[44px] w-full rounded-lg border border-stone-300 px-3 text-base focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--bp-accent)]";

/** The pre-chat questions, one per screen, with progress. */
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
    <div className="flex min-h-full flex-col">
      <PageHeader branding={branding} />
      <div
        className="h-1 bg-stone-200"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={fields.length}
        aria-valuenow={index + 1}
        aria-label={fill(copy.prechat.progress, { n: index + 1, total: fields.length })}
      >
        <div
          className="h-1 bg-[var(--bp-accent)] transition-all"
          style={{ width: `${((index + 1) / fields.length) * 100}%` }}
        />
      </div>
      <form
        key={field.id}
        onSubmit={next}
        className="mx-auto flex w-full max-w-sm flex-1 flex-col px-6 py-8"
        noValidate
      >
        <p className="text-sm text-stone-500">
          {fill(copy.prechat.progress, { n: index + 1, total: fields.length })}
        </p>
        {field.type === "choice" ? (
          <fieldset className="mt-2" aria-labelledby={`${inputId}-label`}>
            <ScreenHeading id={`${inputId}-label`}>{field.label}</ScreenHeading>
            {!field.required && <p className="text-sm text-stone-500">{copy.prechat.optional}</p>}
            <div className="mt-4 space-y-2">
              {(field.options ?? []).map(option => (
                <label
                  key={option}
                  className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 ${
                    value === option
                      ? "border-[var(--bp-accent)] ring-2 ring-[var(--bp-accent)]"
                      : "border-stone-300"
                  }`}
                >
                  <input
                    type="radio"
                    name={inputId}
                    value={option}
                    checked={value === option}
                    onChange={() => set(option)}
                    className="accent-[var(--bp-accent)]"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : field.type === "consent" ? (
          <>
            <ScreenHeading id={`${inputId}-label`}>{field.label}</ScreenHeading>
            {field.consentText && (
              <p className="mt-3 whitespace-pre-line text-sm text-stone-700">{field.consentText}</p>
            )}
            <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={value === "true"}
                onChange={e => set(e.target.checked ? "true" : "")}
                className="h-5 w-5 accent-[var(--bp-accent)]"
              />
              <span className="font-semibold">{copy.prechat.agree}</span>
            </label>
          </>
        ) : (
          <>
            <ScreenHeading id={`${inputId}-label`}>{field.label}</ScreenHeading>
            {!field.required && <p className="text-sm text-stone-500">{copy.prechat.optional}</p>}
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
              className={inputClass}
            />
          </>
        )}
        {missing && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {copy.prechat.required}
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="mt-auto flex items-center justify-between gap-3 pt-8">
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
