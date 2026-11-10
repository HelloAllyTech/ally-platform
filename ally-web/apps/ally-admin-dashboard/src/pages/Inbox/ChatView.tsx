import React, { useEffect, useRef, useState } from "react";

import {
  useGetInboxThreadQuery,
  useHandBackMutation,
  useReplyInInboxMutation,
  useTakeOverMutation,
} from "@api";
import type { InboxThread } from "@api";
import { Button, PrimaryButton } from "@components/v2";

import { channelLabel, fill, INBOX } from "./copy";

const errorText = (error: unknown): string =>
  (error as { data?: { message?: string } })?.data?.message ?? "Something went wrong. Try again.";

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

/** Who wrote a message, as the team reads it. */
const authorOf = (m: InboxThread["messages"][number], thread: InboxThread): string =>
  m.role === "user"
    ? thread.visitor
    : m.role === "agent_human"
      ? (m.sentBy?.name ?? INBOX.assistant)
      : thread.assistant;

/**
 * One chat (chunk 11a): the thread with sources and ratings, the pre-chat answers, and taking over.
 * While you have it, the assistant is paused in this chat only and your replies go out on its
 * channel; Hand back lets the assistant answer the next message.
 */
export const ChatView: React.FC<{ chatbotId: string; id: string; me: number | null }> = ({
  chatbotId,
  id,
  me,
}) => {
  const { data: thread, isLoading } = useGetInboxThreadQuery({ chatbotId, id });
  const [takeOver, taking] = useTakeOverMutation();
  const [handBack, handing] = useHandBackMutation();
  const [reply, replying] = useReplyInInboxMutation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [thread?.messages.length]);
  useEffect(() => setError(null), [id]);

  if (isLoading || !thread) return <div className="ally-inbox__chat" aria-busy="true" />;

  const mine = thread.heldBy?.id === me;
  const windowClosed =
    thread.replyWindowClosesAt !== null && Date.parse(thread.replyWindowClosesAt) <= Date.now();

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    }
  };

  return (
    <section className="ally-inbox__chat" data-testid="inbox-chat" aria-label={thread.visitor}>
      <header className="ally-inbox__chat-head">
        <div>
          <h2 className="ally-heading">{thread.visitor}</h2>
          <p className="ally-small">
            {thread.assistant} · {channelLabel(thread)}
            {thread.safety && <span className="ally-badge ally-inbox__safety">{INBOX.safety}</span>}
          </p>
        </div>
        <div className="ally-btn-row">
          {!thread.heldBy && (
            <PrimaryButton
              disabled={taking.isLoading}
              onClick={() => void run(() => takeOver({ chatbotId, id }).unwrap())}
            >
              {INBOX.takeOver}
            </PrimaryButton>
          )}
          {thread.heldBy && (
            <Button
              disabled={handing.isLoading}
              onClick={() => void run(() => handBack({ chatbotId, id }).unwrap())}
            >
              {INBOX.handBack}
            </Button>
          )}
        </div>
      </header>

      {thread.heldBy && (
        <p className="ally-inbox__banner" role="status">
          {mine
            ? INBOX.takenOver
            : fill(INBOX.someoneElse, { name: thread.heldBy.name ?? "Someone" })}
        </p>
      )}

      {thread.intake.length > 0 && (
        <dl className="ally-inbox__intake">
          {thread.intake.map(answer => (
            <div key={answer.id}>
              <dt className="ally-small">{answer.label}</dt>
              <dd>{answer.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <ol className="ally-inbox__thread" aria-live="polite">
        {thread.messages.map(m => (
          <li key={m.id} className={`ally-inbox__msg ally-inbox__msg--${m.role}`}>
            <p className="ally-small ally-inbox__author">
              {authorOf(m, thread)} · {time(m.at)}
              {m.handledBy === "crisis" && (
                <span className="ally-badge ally-inbox__safety">{INBOX.safety}</span>
              )}
            </p>
            <p className="ally-inbox__bubble">{m.text}</p>
            {m.citations.length > 0 && (
              <p className="ally-small ally-inbox__sources">
                {m.citations
                  .map(c => c.title)
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {m.rating && (
              <p className="ally-small" aria-label={m.rating === "up" ? "Helpful" : "Not helpful"}>
                {m.rating === "up" ? "👍" : "👎"}
                {m.ratingReason ? ` ${m.ratingReason.replace("_", " ")}` : ""}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />

      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}

      {mine && (
        <form
          className="ally-inbox__reply"
          onSubmit={async event => {
            event.preventDefault();
            if (!text.trim()) return;
            if (await run(() => reply({ chatbotId, id, text: text.trim() }).unwrap())) setText("");
          }}
        >
          {thread.replyWindowClosesAt && (
            <p className="ally-small" role="note">
              {windowClosed
                ? INBOX.windowClosed
                : fill(INBOX.windowOpen, { time: time(thread.replyWindowClosesAt) })}
            </p>
          )}
          <label htmlFor="inbox-reply" className="sr-only">
            {INBOX.replyPlaceholder}
          </label>
          <textarea
            id="inbox-reply"
            className="ally-input"
            rows={3}
            maxLength={4000}
            placeholder={INBOX.replyPlaceholder}
            value={text}
            disabled={windowClosed}
            onChange={event => setText(event.target.value)}
          />
          <PrimaryButton
            type="submit"
            disabled={!text.trim() || replying.isLoading || windowClosed}
          >
            {INBOX.send}
          </PrimaryButton>
        </form>
      )}
    </section>
  );
};
