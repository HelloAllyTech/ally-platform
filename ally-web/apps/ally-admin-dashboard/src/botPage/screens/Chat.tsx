import { useEffect, useRef, useState } from "react";

import {
  ConfirmationCard,
  ErrorText,
  Feedback,
  PageHeader,
  SafetyNotice,
  Sources,
  StepLine,
  StepsDone,
  TypingDots,
} from "../components/parts";
import { fill, type BotPageCopy } from "../copy";
import { safetyCopy } from "../copy/safety";
import { doingLine, doneLines, shortWhen } from "../liveSteps";

import type {
  AnswerFeedback,
  PublicBotPage,
  PublicCitation,
  PublicConfirmation,
  PublicStep,
  StatusCode,
} from "../types";

export interface ChatItem {
  id: string;
  /**
   * `agent_human`: a team member's reply (chunk 11a), shown under their name. `notice`: a line about
   * the chat itself ("Asha from Sunrise Mind has joined the chat").
   */
  role: "user" | "assistant" | "agent_human" | "notice";
  /** Who wrote an `agent_human` reply, as the visitor sees it. */
  sender?: string;
  text: string;
  citations: PublicCitation[];
  /** "Was this helpful?" shows under it (chunk Q2a). */
  rateable?: boolean;
  /** What the assistant did for it (chunk 6b): the collapsed "what I did" line. */
  steps?: PublicStep[];
  /** A booking or change made in it (chunk 6b). */
  confirmation?: PublicConfirmation;
}

/** The reply being written: what the agent is doing, and the checked text revealed so far. */
export interface PendingReply {
  status: StatusCode | null;
  text: string;
  /** The step it's on (chunk 6b): a live step, or "reading" until the first one comes. */
  step?: PublicStep | "reading" | null;
  /** Nothing new for a while: "Still working on it…". */
  slow?: boolean;
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
  onRate,
  onAskPerson,
  onClose,
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
  /** A visitor's rating of one answer (chunk Q2a); without it, no thumbs. */
  onRate?(messageId: string, feedback: AnswerFeedback): void;
  /** "Talk to a person" (chunk 11a); without it, no link (Try it). */
  onAskPerson?(): void;
  /** Close the website widget's panel (chunk 13); without it, no button. */
  onClose?(): void;
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
  const business = branding.title || branding.assistantName;
  // The step line (chunk 6b) while it works, before any text: never once the reply shows.
  const stepText =
    pending && !pending.text && pending.step
      ? pending.slow
        ? copy.steps.doing.slow
        : doingLine(pending.step, copy, business)
      : null;
  const status = pending
    ? pending.text
      ? copy.chat.typing
      : copy.chat.status[pending.status ?? "thinking"]
    : (statusLine ??
      fill(copy.chat.headerIdle, { name: branding.assistantName || branding.title }));

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
        {onClose && (
          <button type="button" className="bp-close" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="ally-sr-only">{copy.embed.close}</span>
          </button>
        )}
      </PageHeader>
      {signedInAs && (
        <p className="bp-signed-in">{fill(copy.chat.signedInAs, { email: signedInAs })}</p>
      )}

      <main className="bp-thread" aria-live="polite" aria-relevant="additions">
        <SafetyNotice
          notice={page.notice}
          disclaimer={page.disclaimer}
          label={safetyCopy(copy).noticeLabel}
        />
        <ol className="bp-messages">
          {page.branding.welcome && !messages.length && !pending && (
            <li className="bp-msg ally-rise">
              <p className="bp-bubble bp-bubble--assistant">{page.branding.welcome}</p>
            </li>
          )}
          {messages.map(m =>
            m.role === "notice" ? (
              <li key={m.id} className="bp-msg bp-notice" role="status">
                {m.text}
              </li>
            ) : m.role === "agent_human" ? (
              <li key={m.id} className="bp-msg ally-rise">
                <p className="bp-sender">{m.sender}</p>
                <div className="bp-bubble bp-bubble--assistant bp-bubble--person">
                  <span className="ally-sr-only">{m.sender}: </span>
                  {m.text}
                </div>
              </li>
            ) : m.role === "user" ? (
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
                {m.confirmation && (
                  <ConfirmationCard
                    confirmation={m.confirmation}
                    copy={copy}
                    when={shortWhen(m.confirmation.title)}
                  />
                )}
                <Sources citations={m.citations} copy={copy} />
                {m.steps && m.steps.length > 0 && (
                  <StepsDone lines={doneLines(m.steps, copy, business)} copy={copy} />
                )}
                {m.rateable && onRate && (
                  <Feedback copy={copy} onRate={feedback => onRate(m.id, feedback)} />
                )}
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
                ) : stepText ? (
                  <StepLine text={stepText} />
                ) : (
                  <TypingDots label={copy.chat.status[pending.status ?? "thinking"]} />
                )}
              </div>
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </main>

      <p role="status" aria-live="polite" className="ally-sr-only">
        {stepText ??
          (pending && !pending.text && pending.status ? copy.chat.status[pending.status] : "")}
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
        {onAskPerson && (
          <button type="button" className="bp-ask-person" onClick={onAskPerson} disabled={busy}>
            {copy.chat.talkToPerson}
          </button>
        )}
      </form>
    </div>
  );
}
