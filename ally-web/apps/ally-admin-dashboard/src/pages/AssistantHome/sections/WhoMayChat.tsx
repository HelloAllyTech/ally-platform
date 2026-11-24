import React, { useState } from "react";

import {
  useAddAccessEntriesMutation,
  useGetAccessListQuery,
  useRemoveAccessEntryMutation,
  useUpdateChatbotMutation,
} from "@api";
import type { AccessEntryInput } from "@api";
import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";
import { ChatbotAccessMode } from "@types";

import { ACCESS_COPY as C } from "../../Credits/copy";
import { Group } from "../fields";

import type { SectionProps } from "./props";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a person typed to what the list stores: +E.164 for a phone, lower case for an email. */
export const normalisePhone = (raw: string): string | null => {
  const digits = raw.replace(/[^\d]/g, "");
  if (!/^[+\d(][\d\s()+.-]*$/.test(raw.trim())) return null;
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
};

/** Splits pasted text (lines, commas, semicolons) into entries; the first bad one is returned. */
export const parseEntries = (text: string): { entries: AccessEntryInput[]; bad: string | null } => {
  const parts = text
    .split(/[\n,;]+/)
    .map(p => p.trim())
    .filter(Boolean);
  const entries: AccessEntryInput[] = [];
  for (const part of parts) {
    if (EMAIL.test(part)) {
      entries.push({ kind: "email", value: part.toLowerCase() });
      continue;
    }
    const phone = normalisePhone(part);
    if (!phone) return { entries, bad: part };
    entries.push({ kind: "phone", value: phone });
  }
  return { entries, bad: null };
};

/**
 * Channels -> Who may chat (stage 6): the chatbot's invite list. Invite only is the one mode for
 * now. Removing someone takes effect at once (the engine reads the list on every message).
 */
export const WhoMayChat: React.FC<SectionProps> = ({ bot, canEdit }) => {
  const { data, isError } = useGetAccessListQuery(bot.id);
  const [add, { isLoading: adding }] = useAddAccessEntriesMutation();
  const [remove] = useRemoveAccessEntryMutation();
  const [update] = useUpdateChatbotMutation();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const listed = bot.accessMode === ChatbotAccessMode.LISTED;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { entries, bad } = parseEntries(text);
    if (bad) return setMessage({ ok: false, text: C.add.invalid(bad) });
    if (entries.length === 0) return setMessage({ ok: false, text: C.add.nothing });
    try {
      const result = await add({ id: bot.id, entries }).unwrap();
      setText("");
      setMessage({ ok: true, text: C.add.added(result.added, result.skipped) });
    } catch {
      setMessage({ ok: false, text: C.add.failed });
    }
  };

  const removeEntry = async (entryId: string) => {
    try {
      await remove({ id: bot.id, entryId }).unwrap();
      setMessage(null);
    } catch {
      setMessage({ ok: false, text: C.list.removeFailed });
    }
  };

  const hasPhone = (data ?? []).some(e => e.kind === "phone");

  return (
    <Group title={C.title} hint={C.hint} testId="who-may-chat">
      <fieldset className="ally-home__choices" disabled={!canEdit}>
        <legend className="ally-sr-only">{C.mode.label}</legend>
        <label className="ally-home__choice is-on">
          <Input
            className="!h-4 !w-4"
            type="radio"
            name={`access-mode-${bot.id}`}
            checked={listed}
            onChange={() => update({ id: bot.id, accessMode: ChatbotAccessMode.LISTED })}
          />
          <span>
            <span className="ally-home__strong">{C.mode.listed}</span>
            <span className="ally-field__hint">{C.mode.listedHint}</span>
          </span>
        </label>
      </fieldset>
      <p className="ally-field__hint">{C.mode.note}</p>

      {canEdit && (
        <form onSubmit={submit} noValidate>
          <label className="ally-field__label" htmlFor={`access-add-${bot.id}`}>
            {C.add.label}
          </label>
          <textarea
            id={`access-add-${bot.id}`}
            className="ally-input"
            rows={3}
            value={text}
            placeholder={C.add.placeholder}
            onChange={e => setText(e.target.value)}
          />
          <p className="ally-field__hint">{C.add.hint}</p>
          <Button variant={ButtonVariant.SECONDARY} type="submit" disabled={adding}>
            {C.add.action}
          </Button>
        </form>
      )}
      {message && (
        <p
          className={message.ok ? "ally-field__hint" : "ally-error"}
          role={message.ok ? "status" : "alert"}
          data-testid="access-message"
        >
          {message.text}
        </p>
      )}
      {hasPhone && (
        <p className="ally-field__hint" data-testid="access-whatsapp-note">
          {C.whatsappNote}
        </p>
      )}

      {isError && (
        <p className="ally-error" role="alert">
          {C.list.loadFailed}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="ally-body" data-testid="access-empty">
          {C.list.empty}
        </p>
      )}
      {data && data.length > 0 && (
        <table className="ally-table" style={{ width: "100%" }} data-testid="access-list">
          <thead>
            <tr>
              <th align="left">{C.list.columns.who}</th>
              <th align="left">{C.list.columns.kind}</th>
              <th align="left">{C.list.columns.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map(entry => (
              <tr key={entry.id} data-testid="access-entry">
                <td>{entry.label ? `${entry.label} (${entry.value})` : entry.value}</td>
                <td>{C.list.kinds[entry.kind] ?? entry.kind}</td>
                <td>
                  {/* TODO(stage 6, ally-be): the list route has no per-entry match flag yet. */}
                  {entry.everMatched === undefined
                    ? "—"
                    : entry.everMatched
                      ? C.list.matched
                      : C.list.never}
                </td>
                <td>
                  {canEdit && (
                    <Button
                      variant={ButtonVariant.TEXT}
                      type="button"
                      aria-label={C.list.remove(entry.value)}
                      onClick={() => removeEntry(entry.id)}
                    >
                      ×
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Group>
  );
};
