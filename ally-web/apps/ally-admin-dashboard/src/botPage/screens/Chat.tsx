import { useEffect, useRef, useState } from "react";

import { ErrorText, PageHeader, Sources, TypingDots } from "../components/parts";
import { fill, type BotPageCopy } from "../copy";

import type { PublicBotPage, PublicCitation, StatusCode } from "../types";

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: PublicCitation[];
}

/** The reply being written: what the agent is doing, and the checked text revealed so far. */
export interface PendingReply {
  status: StatusCode | null;
  text: string;
}

export function Chat({
  page,
  copy,
  messages,
  pending,
  onSend,
  onNewChat,
  busy = false,
  error,
  signedInAs,
  returnedDraft,
  statusLine,
}: {
  page: PublicBotPage;
  copy: BotPageCopy;
  messages: ChatItem[];
  pending: PendingReply | null;
  onSend(text: string): void;
  onNewChat(): void;
  busy?: boolean;
  error?: string | null;
  signedInAs?: string | null;
  /** A message that was refused before it was answered, put back in the box to send again. */
  returnedDraft?: { text: string } | null;
  /** Under the name in the header: what the assistant is doing, or how fast it replies. */
  statusLine?: string;
}) {
  const { branding } = page;
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const tooLong = draft.length > page.maxMessageChars;

  // A refused message comes back to the box (state adjusted during render, not in an effect).
  const [seenReturned, setSeenReturned] = useState(returnedDraft);
  if (returnedDraft !== seenReturned) {
    setSeenReturned(returnedDraft);
    if (returnedDraft) setDraft(returnedDraft.text);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, pending?.text, pending?.status]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || busy || value.length > page.maxMessageChars) return;
    onSend(value);
    setDraft("");
  };

  // The header says what the assistant is doing while it works, else where its answers come from.
  const status = pending
    ? pending.text
      ? copy.chat.typing
      : copy.chat.status[pending.status ?? "thinking"]
    : (statusLine ?? fill(copy.chat.headerIdle, { name: branding.title }));

  return (
    <div className="bp-chat">
      <PageHeader branding={branding} subtitle={status}>
        <button
          type="button"
          className="bp-pill"
          onClick={onNewChat}
          disabled={busy || (!messages.length && !pending)}
        >
          {copy.chat.newChat}
        </button>
      </PageHeader>
      {signedInAs && (
        <p className="bp-signed-in">{fill(copy.chat.signedInAs, { email: signedInAs })}</p>
      )}

      <main className="bp-thread" aria-live="polite" aria-relevant="additions">
        <ol className="bp-messages">
          {page.branding.subtitle && !messages.length && !pending && (
            <li className="bp-msg ally-rise">
              <p className="bp-bubble bp-bubble--assistant">{page.branding.subtitle}</p>
            </li>
          )}
          {messages.map(m =>
            m.role === "user" ? (
              <li key={m.id} className="bp-msg bp-msg--user ally-rise">
                <p className="bp-bubble bp-bubble--user">
                  <span className="ally-sr-only">{copy.chat.you}: </span>
                  {m.text}
                </p>
              </li>
            ) : (
              <li key={m.id} className="bp-msg ally-rise">
                <div className="bp-bubble bp-bubble--assistant">
                  <span className="ally-sr-only">{branding.assistantName}: </span>
                  {m.text}
                </div>
                <Sources citations={m.citations} copy={copy} />
              </li>
            ),
          )}
          {pending && (
            <li className="bp-msg">
              <div className="bp-bubble bp-bubble--assistant">
                {pending.text ? (
                  <>
                    {pending.text}
                    <span aria-hidden="true" className="ally-caret" />
                  </>
                ) : (
                  <TypingDots label={copy.chat.status[pending.status ?? "thinking"]} />
                )}
              </div>
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </main>

      <p role="status" className="ally-sr-only">
        {pending && !pending.text && pending.status ? copy.chat.status[pending.status] : ""}
      </p>

      {!messages.length && !pending && page.suggestedQuestions.length > 0 && (
        <div className="bp-suggested">
          <p className="ally-sr-only">{copy.chat.suggested}</p>
          <div className="ally-chips">
            {page.suggestedQuestions.map(q => (
              <button
                key={q}
                type="button"
                className="ally-chip ally-press"
                onClick={() => send(q)}
                disabled={busy}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        className="bp-composer"
        onSubmit={e => {
          e.preventDefault();
          send(draft);
        }}
      >
        <ErrorText>{error}</ErrorText>
        <div className="bp-composer__box">
          <label htmlFor="bp-message" className="ally-sr-only">
            {copy.chat.inputLabel}
          </label>
          <textarea
            id="bp-message"
            rows={1}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder={copy.chat.placeholder}
            aria-invalid={tooLong || undefined}
            aria-describedby="bp-count"
          />
          <button
            type="submit"
            className="bp-send ally-press"
            aria-label={copy.chat.send}
            disabled={busy || !draft.trim() || tooLong}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
        <p id="bp-count" className="bp-count" data-over={tooLong}>
          {draft.length > page.maxMessageChars * 0.8
            ? fill(copy.chat.tooLong, { count: draft.length, max: page.maxMessageChars })
            : ""}
        </p>
      </form>
    </div>
  );
}
