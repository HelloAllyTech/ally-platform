import React, { useState } from "react";

import { Link } from "react-router-dom";

import {
  useEditMemoryLineMutation,
  useForgetMemoryLineMutation,
  useForgetPersonMutation,
  useGetPersonMemoryQuery,
  type MemoryLine,
} from "@api";
import { Button } from "@components/button";
import { Input } from "@components/input";
import { ButtonVariant } from "@components/types";

import { INBOX, fill } from "./copy";
import { Sheet } from "../AssistantHome/ui/Sheet";

const t = INBOX.memory;

/** Open items first, then preferences, then context: the order the assistant reads them in. */
const ORDER: MemoryLine["section"][] = ["open_items", "preferences", "context"];

/** "12 Nov": the day they last said it, never with the year. */
const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const errorOf = (failure: unknown): string => {
  const code = (failure as { data?: { code?: string } })?.data?.code;
  return code === "never_store" ? t.neverStore : code === "invalid" ? t.invalid : t.editFailed;
};

/** One line: its text, where it came from, and Forget and Edit for editors. */
const Line: React.FC<{
  chatbotId: string;
  line: MemoryLine;
  /** Said in the chat open beside it. */
  here: boolean;
  canEdit: boolean;
  onOpenSource: (line: MemoryLine) => void;
  onForgotten: () => void;
}> = ({ chatbotId, line, here, canEdit, onOpenSource, onForgotten }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(line.text);
  const [error, setError] = useState<string | null>(null);
  const [edit, editing$] = useEditMemoryLineMutation();
  const [forget, forgetting] = useForgetMemoryLineMutation();

  const save = async () => {
    setError(null);
    const value = text.trim();
    if (!value || value.length > 200) {
      setError(t.invalid);
      return;
    }
    try {
      await edit({ chatbotId, id: line.id, text: value }).unwrap();
      setEditing(false);
    } catch (failure) {
      setError(errorOf(failure));
    }
  };

  return (
    <li className="ally-memory__line" data-testid="memory-line">
      {editing ? (
        <div className="ally-memory__edit">
          <Input
            className="ally-input"
            aria-label={t.edit}
            value={text}
            maxLength={200}
            autoFocus
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <div className="ally-btn-row">
            <Button
              variant={ButtonVariant.TERTIARY}
              size="sm"
              type="button"
              disabled={editing$.isLoading}
              onClick={() => void save()}
            >
              {t.save}
            </Button>
            <Button
              variant={ButtonVariant.TERTIARY}
              size="sm"
              type="button"
              onClick={() => {
                setEditing(false);
                setText(line.text);
                setError(null);
              }}
            >
              {t.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <p className="ally-body">{line.text}</p>
      )}
      <p className="ally-small ally-memory__meta">
        {line.sourceMessageId ? (
          <Button
            variant={ButtonVariant.TEXT}
            size="sm"
            type="button"
            className="ally-link ally-link--inline"
            onClick={() => onOpenSource(line)}
          >
            {fill(here ? t.saidHere : t.saidEarlier, { date: dayOf(line.saidAt) })}
          </Button>
        ) : (
          <span>{dayOf(line.saidAt)}</span>
        )}
        <span>
          {" · "}
          {line.expiresAt ? fill(t.keptUntil, { date: dayOf(line.expiresAt) }) : t.keptForever}
        </span>
        {line.sourceKind === "owner" && <span> · {t.byTeam}</span>}
      </p>
      {error && (
        <p className="ally-small ally-memory__error" role="alert">
          {error}
        </p>
      )}
      {canEdit && !editing && (
        <div className="ally-btn-row">
          <Button
            variant={ButtonVariant.TEXT}
            size="sm"
            type="button"
            className="ally-link ally-link--inline ally-small"
            aria-label={fill(t.forgetLine, { line: line.text })}
            disabled={forgetting.isLoading}
            onClick={async () => {
              try {
                await forget({ chatbotId, id: line.id }).unwrap();
                onForgotten();
              } catch {
                setError(t.editFailed);
              }
            }}
          >
            {t.forget}
          </Button>
          <Button
            variant={ButtonVariant.TEXT}
            size="sm"
            type="button"
            className="ally-link ally-link--inline ally-small"
            onClick={() => setEditing(true)}
          >
            {t.edit}
          </Button>
        </div>
      )}
    </li>
  );
};

/** Asks once before everything about a person is forgotten; Keep is the safe choice. */
const ForgetPersonDialog: React.FC<{
  chatbotId: string;
  contactId: string;
  name: string | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ chatbotId, contactId, name, onClose, onDone }) => {
  const [forgetPerson, { isLoading }] = useForgetPersonMutation();
  const [failed, setFailed] = useState(false);
  const title = name ? fill(t.confirmTitle, { name }) : t.confirmTitleNoName;
  return (
    <Sheet side="center" label={title} onClose={onClose} testId="forget-person">
      <div className="ally-remove">
        <h2 className="ally-heading">{title}</h2>
        <p className="ally-small">{t.confirmBody}</p>
        {failed && (
          <p className="ally-small ally-remove__error" role="alert">
            {t.editFailed}
          </p>
        )}
        <div className="ally-remove__actions">
          <Button variant={ButtonVariant.TERTIARY} type="button" onClick={onClose}>
            {t.keep}
          </Button>
          <Button
            variant={ButtonVariant.PRIMARY}
            type="button"
            className="ally-remove__confirm"
            disabled={isLoading}
            onClick={async () => {
              setFailed(false);
              try {
                await forgetPerson({ chatbotId, contactId }).unwrap();
                onDone();
              } catch {
                setFailed(true);
              }
            }}
          >
            {t.confirm}
          </Button>
        </div>
      </div>
    </Sheet>
  );
};

/**
 * What the assistant remembers about the person in this chat (chunk 8a): their notes by section,
 * each with the day they said it and a link to that message; Forget and Edit on each line, and
 * Forget this person, for editors. With memory off, one line and the way to the switch.
 */
export const MemoryPanel: React.FC<{
  chatbotId: string;
  contactId: string;
  conversationId: string;
  canEdit: boolean;
  onOpenSource: (conversationId: string, messageId: string) => void;
}> = ({ chatbotId, contactId, conversationId, canEdit, onOpenSource }) => {
  const { data, isLoading, isError, refetch } = useGetPersonMemoryQuery({
    chatbotId,
    contactId,
    conversationId,
  });
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const title = data?.name ? fill(t.title, { name: data.name }) : t.titleNoName;
  const open = (line: MemoryLine) =>
    line.sourceMessageId &&
    onOpenSource(line.sourceConversationId ?? conversationId, line.sourceMessageId);

  let body: React.ReactNode;
  if (isLoading) {
    body = <div className="ally-memory__loading" aria-busy="true" />;
  } else if (isError || !data) {
    body = (
      <p className="ally-note ally-note--warn" role="alert">
        {t.loadFailed}{" "}
        <Button
          variant={ButtonVariant.TEXT}
          size="sm"
          type="button"
          className="ally-link ally-link--inline"
          onClick={() => void refetch()}
        >
          {t.retry}
        </Button>
      </p>
    );
  } else {
    const notes =
      !data.on && !data.lines.length ? (
        <p className="ally-small" data-testid="memory-off">
          {t.off} <Link to={`/chatbots/${chatbotId}?section=lists&tool=memory`}>{t.turnOn}</Link>
        </p>
      ) : !data.lines.length ? (
        <p className="ally-small">{t.empty}</p>
      ) : (
        ORDER.filter(section => data.lines.some(l => l.section === section)).map(section => (
          <div key={section} className="ally-memory__section">
            <h5 className="ally-memory__heading">{t.sections[section]}</h5>
            <p className="ally-small ally-memory__hint">{t.sectionHints[section]}</p>
            <ul className="ally-memory__lines">
              {data.lines
                .filter(l => l.section === section)
                .map(line => (
                  <Line
                    key={line.id}
                    chatbotId={chatbotId}
                    line={line}
                    here={line.sourceConversationId === conversationId}
                    canEdit={canEdit}
                    onOpenSource={open}
                    onForgotten={() => setNotice(t.forgotten)}
                  />
                ))}
            </ul>
          </div>
        ))
      );
    body = (
      <>
        {(data.on || data.lines.length > 0) && (
          <p className="ally-small ally-memory__intro">
            {data.name ? fill(t.intro, { name: data.name }) : t.introNoName}
          </p>
        )}
        <section className="ally-memory__block" aria-label={t.about}>
          <h4 className="ally-memory__title">{t.about}</h4>
          <dl className="ally-memory__facts">
            <div>
              <dt className="ally-small">{t.name}</dt>
              <dd>{data.name ?? <span className="ally-small">{t.noName}</span>}</dd>
            </div>
          </dl>
          {data.beforeChat.length > 0 && (
            <>
              <h5 className="ally-memory__heading">{t.beforeChat}</h5>
              <p className="ally-small ally-memory__hint">{t.beforeChatHint}</p>
              <dl className="ally-memory__facts" data-testid="memory-before-chat">
                {data.beforeChat.map(answer => (
                  <div key={answer.label}>
                    <dt className="ally-small">{answer.label}</dt>
                    <dd>{answer.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
        <section className="ally-memory__block" aria-label={t.notes}>
          <h4 className="ally-memory__title">{t.notes}</h4>
          {notes}
        </section>
        {data.summary && (
          <section className="ally-memory__block" aria-label={t.summary}>
            <h4 className="ally-memory__title">{t.summary}</h4>
            <p className="ally-small ally-memory__hint">{t.summaryHint}</p>
            <p className="ally-body ally-memory__summary" data-testid="memory-summary">
              {data.summary}
            </p>
          </section>
        )}
        {data.on && data.neverStore.length > 0 && (
          <section className="ally-memory__block" aria-label={t.neverKeeps}>
            <h4 className="ally-memory__title">{t.neverKeeps}</h4>
            <ul className="ally-memory__never">
              {data.neverStore.map(item => (
                <li key={item} className="ally-badge ally-badge--muted">
                  {item}
                </li>
              ))}
            </ul>
            <Link className="ally-small" to={`/chatbots/${chatbotId}?section=lists&tool=memory`}>
              {t.changeNever}
            </Link>
          </section>
        )}
      </>
    );
  }

  return (
    <aside className="ally-memory" aria-label={title} data-testid="memory-panel">
      <h3 className="ally-home__group-title">{title}</h3>
      {body}
      {notice && (
        <p className="ally-small" role="status">
          {notice}
        </p>
      )}
      {canEdit && data && data.lines.length > 0 && (
        <Button
          variant={ButtonVariant.TEXT}
          size="sm"
          type="button"
          className="ally-link ally-link--inline ally-small ally-memory__forget-person"
          onClick={() => setConfirming(true)}
        >
          {t.forgetPerson}
        </Button>
      )}
      {confirming && (
        <ForgetPersonDialog
          chatbotId={chatbotId}
          contactId={contactId}
          name={data?.name ?? null}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            setNotice(t.forgotPerson);
          }}
        />
      )}
    </aside>
  );
};
