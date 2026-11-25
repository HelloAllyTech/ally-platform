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
import { TF1_COPY } from "../copy/tf1";
import { Group } from "../fields";
import { useHomeField } from "../useHomeField";

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
export const WhoMayChat: React.FC<SectionProps> = ({ bot, home, canEdit }) => {
  const { data, isError } = useGetAccessListQuery(bot.id);
  const [add, { isLoading: adding }] = useAddAccessEntriesMutation();
  const [remove] = useRemoveAccessEntryMutation();
  const [update] = useUpdateChatbotMutation();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // TF1: the page's own access decides who can open the link (public needs no sign-in).
  const pageAccess = home?.fields?.pageAccess?.value ?? "invite";
  const inviteListed = () => {
    if (bot.accessMode !== ChatbotAccessMode.LISTED) {
      void update({ id: bot.id, accessMode: ChatbotAccessMode.LISTED });
    }
  };

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
      {pageAccess === "public" && home?.fields?.pageAccess ? (
        <PublicPageSwitch
          bot={bot}
          canEdit={canEdit}
          field={home.fields.pageAccess}
          onInvite={inviteListed}
        />
      ) : (
        <AccessChoices
          botId={bot.id}
          canEdit={canEdit}
          pageAccess={pageAccess}
          onInvite={inviteListed}
        />
      )}

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
          {pageAccess === "public" ? TF1_COPY.access.emptyWhilePublic : C.list.empty}
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

/**
 * TF1 (25 Nov): who can chat, as choices. Public is shown but off for now; a page that is
 * public already shows it selected, so the owner sees the truth and can switch to Invite only.
 */
const AccessChoices: React.FC<{
  botId: string;
  canEdit: boolean;
  pageAccess: string;
  onInvite: () => void;
  error?: string | null;
}> = ({ botId, canEdit, pageAccess, onInvite, error }) => (
  <>
    <fieldset className="ally-home__choices" disabled={!canEdit}>
      <legend className="ally-sr-only">{C.mode.label}</legend>
      <label className={`ally-home__choice${pageAccess === "invite" ? " is-on" : ""}`}>
        <Input
          className="!h-4 !w-4"
          type="radio"
          name={`access-mode-${botId}`}
          checked={pageAccess === "invite"}
          onChange={onInvite}
        />
        <span>
          <span className="ally-home__strong">{C.mode.listed}</span>
          <span className="ally-field__hint">{C.mode.listedHint}</span>
        </span>
      </label>
      <label
        className={`ally-home__choice${pageAccess === "public" ? " is-on" : ""}`}
        data-testid="access-public"
      >
        <Input
          className="!h-4 !w-4"
          type="radio"
          name={`access-mode-${botId}`}
          checked={pageAccess === "public"}
          disabled
          readOnly
          aria-label={TF1_COPY.access.publicChoiceLabel}
        />
        <span>
          <span className="ally-home__strong">{TF1_COPY.access.publicChoice}</span>
          <span className="ally-field__hint">{TF1_COPY.access.publicChoiceHint}</span>
        </span>
      </label>
    </fieldset>
    {/* TF1 B2: who can chat now, in one plain line, from the page's own access. */}
    <p className="ally-field__hint" data-testid="who-can-chat-line">
      {pageAccess === "organisation"
        ? TF1_COPY.access.organisation
        : pageAccess === "public"
          ? TF1_COPY.access.public
          : TF1_COPY.access.invite}
    </p>
    {pageAccess === "public" && (
      <p className="ally-field__hint" data-testid="access-public-now">
        {TF1_COPY.access.publicNow}
      </p>
    )}
    {error && (
      <p className="ally-error" role="alert">
        {error}
      </p>
    )}
  </>
);

/** A page that is public now: choosing Invite only saves the page's access. */
const PublicPageSwitch: React.FC<{
  bot: SectionProps["bot"];
  canEdit: boolean;
  field: NonNullable<SectionProps["home"]>["fields"]["pageAccess"];
  onInvite: () => void;
}> = ({ bot, canEdit, field, onInvite }) => {
  const access = useHomeField(bot.id, "pageAccess", field, TF1_COPY.access.switchFailed);
  return (
    <AccessChoices
      botId={bot.id}
      canEdit={canEdit}
      pageAccess={access.value}
      error={access.error}
      onInvite={() => {
        access.set("invite", { now: true });
        onInvite();
      }}
    />
  );
};
