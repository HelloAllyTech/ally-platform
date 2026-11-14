import React, { useId } from "react";

import { Button } from "@components/v2";
import { ChatbotStatus } from "@types";
import type { BotPageLimits, PrechatField } from "@types";

import { LookAndFeelSection } from "../../WhatsAppBot/LookAndFeel";
import { fill, HOME } from "../copy";
import { Group, SectionHead, TextField, useDraftList } from "../fields";
import { HomeField, useHomeField } from "../useHomeField";

import type { SectionProps } from "./props";

const t = HOME.page;
const TYPES = Object.keys(t.types) as PrechatField["type"][];
const MAX_PRECHAT = 8;

const newId = (fields: PrechatField[]): string => {
  let n = fields.length + 1;
  while (fields.some(f => f.id === `q${n}`)) n += 1;
  return `q${n}`;
};

/** One question before the chat: its wording, type, options or agreement text, and Required. */
const Question: React.FC<{
  field: PrechatField;
  index: number;
  disabled: boolean;
  onChange: (next: PrechatField, now?: boolean) => void;
  onRemove: () => void;
  onBlur: () => void;
}> = ({ field, index, disabled, onChange, onRemove, onBlur }) => {
  const id = useId();
  return (
    <li className="ally-card ally-home__question" data-testid={`prechat-${field.id}`}>
      <div className="ally-field">
        <label htmlFor={`${id}-label`}>{fill(t.question, { n: index + 1 })}</label>
        <input
          id={`${id}-label`}
          className="ally-input"
          value={field.label}
          disabled={disabled}
          maxLength={200}
          onChange={event => onChange({ ...field, label: event.target.value })}
          onBlur={onBlur}
        />
      </div>
      <div className="ally-home__row">
        <label className="ally-sr-only" htmlFor={`${id}-type`}>
          {t.types[field.type]}
        </label>
        <select
          id={`${id}-type`}
          className="ally-input ally-home__select"
          value={field.type}
          disabled={disabled}
          onChange={event => {
            const type = event.target.value as PrechatField["type"];
            onChange(
              {
                id: field.id,
                label: field.label,
                type,
                required: type === "consent" ? true : field.required,
                ...(type === "choice" ? { options: field.options ?? [] } : {}),
                ...(type === "consent" ? { consentText: field.consentText ?? "" } : {}),
              },
              type !== "choice" && type !== "consent",
            );
          }}
        >
          {TYPES.map(type => (
            <option key={type} value={type}>
              {t.types[type]}
            </option>
          ))}
        </select>
        {field.type !== "consent" && (
          <label className="ally-home__check">
            <input
              type="checkbox"
              checked={field.required}
              disabled={disabled}
              onChange={event => onChange({ ...field, required: event.target.checked }, true)}
            />
            {t.required}
          </label>
        )}
        {!disabled && (
          <button
            type="button"
            className="ally-link"
            aria-label={`${HOME.safety.remove}: ${field.label || fill(t.question, { n: index + 1 })}`}
            onClick={onRemove}
          >
            {HOME.safety.remove}
          </button>
        )}
      </div>
      {field.type === "choice" && (
        <div className="ally-field">
          <label htmlFor={`${id}-options`}>{t.options}</label>
          <textarea
            id={`${id}-options`}
            className="ally-input"
            rows={3}
            disabled={disabled}
            value={(field.options ?? []).join("\n")}
            onChange={event => onChange({ ...field, options: event.target.value.split("\n") })}
            onBlur={onBlur}
          />
        </div>
      )}
      {field.type === "consent" && (
        <div className="ally-field">
          <label htmlFor={`${id}-consent`}>{t.consentText}</label>
          <textarea
            id={`${id}-consent`}
            className="ally-input"
            rows={2}
            disabled={disabled}
            value={field.consentText ?? ""}
            maxLength={1000}
            onChange={event => onChange({ ...field, consentText: event.target.value })}
            onBlur={onBlur}
          />
        </div>
      )}
    </li>
  );
};

const isComplete = (q: PrechatField): boolean =>
  q.label.trim() !== "" &&
  (q.type !== "choice" || (q.options ?? []).some(o => o.trim())) &&
  (q.type !== "consent" || Boolean(q.consentText?.trim()));

const PrechatEditor: React.FC<{ field: HomeField<PrechatField[]>; disabled: boolean }> = ({
  field,
  disabled,
}) => {
  // A question is saved once it's complete: its words, a choice's options, an agreement's text.
  // Until then it stays on screen only.
  const [questions, set] = useDraftList(field, isComplete);
  // A choice's options are saved without blank lines (the server refuses an empty option).
  const clean = (list: PrechatField[]) =>
    list.map(q =>
      q.type === "choice"
        ? { ...q, options: (q.options ?? []).map(o => o.trim()).filter(Boolean) }
        : q,
    );
  return (
    <>
      {questions.length > 0 && (
        <ol className="ally-home__questions">
          {questions.map((question, index) => (
            <Question
              key={question.id}
              field={question}
              index={index}
              disabled={disabled}
              onChange={(next, now) =>
                set(
                  questions.map((q, n) => (n === index ? next : q)),
                  now,
                )
              }
              onRemove={() =>
                set(
                  questions.filter((_, n) => n !== index),
                  true,
                )
              }
              onBlur={() => {
                const cleaned = clean(questions);
                if (JSON.stringify(cleaned) !== JSON.stringify(questions)) set(cleaned, true);
                else field.flush();
              }}
            />
          ))}
        </ol>
      )}
      {!disabled && questions.length < MAX_PRECHAT && (
        <div>
          <Button
            onClick={() =>
              // A new question waits for its wording before it's saved.
              set([
                ...questions,
                { id: newId(questions), label: "", type: "text", required: false },
              ])
            }
          >
            {t.addQuestion}
          </Button>
        </div>
      )}
      {field.error && (
        <p className="ally-error" role="alert">
          {field.error}
        </p>
      )}
    </>
  );
};

const LimitsEditor: React.FC<{ field: HomeField<BotPageLimits>; disabled: boolean }> = ({
  field,
  disabled,
}) => {
  const id = useId();
  const limits = field.value;
  const row = (key: keyof BotPageLimits, label: string, min: number, max: number) => (
    <div className="ally-field ally-home__limit">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className="ally-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={disabled}
        value={Number.isFinite(limits[key]) ? limits[key] : ""}
        onChange={event => field.set({ ...limits, [key]: Number(event.target.value) })}
        onBlur={field.flush}
      />
    </div>
  );
  return (
    <>
      <div className="ally-home__limits">
        {row("messagesPerVisitorPerHour", t.perHour, 1, 200)}
        {row("maxMessageChars", t.maxChars, 50, 2000)}
        {row("dailyCapPerBot", t.perDay, 1, 20000)}
      </div>
      {field.error && (
        <p className="ally-error" role="alert">
          {field.error}
        </p>
      )}
    </>
  );
};

/**
 * The assistant's page (chunk 20d): its name at the top, how it looks (Look and feel, with the live
 * phone), the questions it asks before a chat, and its limits.
 */
export const PageSection: React.FC<SectionProps> = ({ bot, home, canEdit, go }) => {
  const f = home.fields;
  const failed = HOME.saving.failed;
  const name = useHomeField(bot.id, "name", f.name, failed);
  const prechat = useHomeField(bot.id, "prechat", f.prechat, failed);
  const limits = useHomeField(bot.id, "pageLimits", f.pageLimits, failed);
  const busy = useHomeField(bot.id, "busyText", f.busyText, failed);
  const on = f.pageStatus.value === "on";
  return (
    <>
      <SectionHead
        title={HOME.sections.page}
        subtitle={HOME.subtitles.page}
        help={HOME.help.page}
      />

      {/* One switch (the assistant's, in Overview): this says where the page stands and why. */}
      <Group testId="page-status">
        <div className="ally-home__row">
          <div>
            <p className="ally-body ally-home__strong">{on ? t.on : t.off}</p>
            <p className="ally-small">
              {on && bot.status === ChatbotStatus.PAUSED ? t.pausedNote : t.followsLive}
            </p>
          </div>
          {canEdit && <Button onClick={() => go("overview")}>{t.toOverview}</Button>}
        </div>
      </Group>

      <Group testId="page-name">
        <TextField
          label={t.businessName}
          hint={t.businessNameHint}
          field={name}
          disabled={!canEdit}
          maxLength={80}
        />
      </Group>

      <div className="ally-home__look">
        <LookAndFeelSection bot={bot} canEdit={canEdit} />
      </div>

      <Group title={t.prechat} hint={t.prechatHint} testId="page-prechat">
        <PrechatEditor field={prechat} disabled={!canEdit} />
      </Group>

      <Group title={t.limits} testId="page-limits">
        <LimitsEditor field={limits} disabled={!canEdit} />
        <TextField label={t.busy} field={busy} disabled={!canEdit} multiline maxLength={500} />
      </Group>
    </>
  );
};
