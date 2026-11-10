import React, { useEffect, useRef, useState } from "react";

import {
  useGetInboxThreadQuery,
  useHandBackMutation,
  useReplyInInboxMutation,
  useTakeOverMutation,
  useAddCheckupCaseMutation,
} from "@api";
import type { InboxThread } from "@api";
import { Button, PrimaryButton } from "@components/v2";

import { channelLabel, fill, INBOX } from "./copy";
import { CheckupCaseEditor } from "../AssistantHome/sections/CheckupCaseEditor";

const errorText = (error: unknown): string =>
  (error as { data?: { message?: string } })?.data?.message ?? "Something went wrong. Try again.";

/**
 * "Add to checkup" from a reply (chunk 20d-2): the visitor's question before it, and the reply's
 * sentences as what a good answer includes. The owner edits either before saving.
 */
const prefill = (messages: InboxThread["messages"], index: number) => {
  const asked = [...messages.slice(0, index)].reverse().find(m => m.role === "user");
  const facts = (messages[index]?.text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map(line => line.trim())
    .filter(line => line.length > 3)
    .slice(0, 4);
  return { question: asked?.text.slice(0, 500) ?? "", outcome: "answer" as const, facts };
};

/** Messages from one sender this close together are one group. */
const GROUP_MS = 2 * 60 * 1000;

const dayOf = (iso: string) => new Date(iso).toDateString();

/** "Today", "Yesterday", or "9 Nov": once a day, above that day's messages. */
const dayLabel = (iso: string) => {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayOf(iso) === today.toDateString()) return INBOX.today;
  if (dayOf(iso) === yesterday.toDateString()) return INBOX.yesterday;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const clock = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(AM|PM)\b/g, m => m.toLowerCase());

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
export const ChatView: React.FC<{
  chatbotId: string;
  id: string;
  me: number | null;
  /** Editors can turn a real reply into a checkup question (chunk 20d-2). */
  canAddToCheckup?: boolean;
}> = ({ chatbotId, id, me, canAddToCheckup = false }) => {
  const { data: thread, isLoading } = useGetInboxThreadQuery({ chatbotId, id });
  const [takeOver, taking] = useTakeOverMutation();
  const [handBack, handing] = useHandBackMutation();
  const [reply, replying] = useReplyInInboxMutation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [add, addCase] = useAddCheckupCaseMutation();

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
        <div className="ally-inbox__chat-name">
          <h2 className="ally-heading">{thread.visitor}</h2>
          {/* On the name's line, right-aligned (chunk 20d-2). */}
          {!thread.heldBy ? (
            <Button
              className="ally-btn--sm"
              disabled={taking.isLoading}
              onClick={() => void run(() => takeOver({ chatbotId, id }).unwrap())}
            >
              {INBOX.takeOver}
            </Button>
          ) : (
            <Button
              className="ally-btn--sm"
              disabled={handing.isLoading}
              onClick={() => void run(() => handBack({ chatbotId, id }).unwrap())}
            >
              {INBOX.handBack}
            </Button>
          )}
        </div>
        <p className="ally-small">
          {thread.assistant} · {channelLabel(thread)}
          {thread.safety && <span className="ally-badge ally-inbox__safety">{INBOX.safety}</span>}
        </p>
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
        {thread.messages.map((m, index) => {
          const before = thread.messages[index - 1];
          const newDay = !before || dayOf(before.at) !== dayOf(m.at);
          // Messages from one sender within 2 minutes share their name and time.
          const grouped =
            !newDay &&
            before.role === m.role &&
            authorOf(before, thread) === authorOf(m, thread) &&
            Date.parse(m.at) - Date.parse(before.at) < GROUP_MS &&
            m.handledBy !== "crisis";
          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <li className="ally-inbox__day" aria-hidden="false">
                  <span>{dayLabel(m.at)}</span>
                </li>
              )}
              <li
                className={`ally-inbox__msg ally-inbox__msg--${m.role}${grouped ? " ally-inbox__msg--grouped" : ""}`}
              >
                {!grouped && (
                  <p className="ally-small ally-inbox__author">
                    {authorOf(m, thread)} · {clock(m.at)}
                    {m.handledBy === "crisis" && (
                      <span className="ally-badge ally-inbox__safety">{INBOX.safety}</span>
                    )}
                  </p>
                )}
                <p className="ally-inbox__bubble">{m.text}</p>
                {m.citations.length > 0 && (
                  <p className="ally-small ally-inbox__sources">
                    {m.citations
                      .map(c => c.title)
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {m.role === "assistant" && canAddToCheckup && adding !== m.id && (
                  <button
                    type="button"
                    className="ally-link ally-small ally-inbox__add-checkup"
                    onClick={() => setAdding(m.id)}
                  >
                    {INBOX.addToCheckup}
                  </button>
                )}
                {adding === m.id && (
                  <CheckupCaseEditor
                    title={INBOX.addToCheckup}
                    initial={prefill(thread.messages, index)}
                    busy={addCase.isLoading}
                    error={addError}
                    onSave={async input => {
                      setAddError(null);
                      try {
                        await add({
                          id: chatbotId,
                          input: { ...input, addedFrom: "chat" },
                        }).unwrap();
                        setAdding(null);
                        setAdded(m.id);
                      } catch (failure) {
                        setAddError(errorText(failure));
                      }
                    }}
                    onCancel={() => setAdding(null)}
                  />
                )}
                {added === m.id && (
                  <p className="ally-small" role="status">
                    {INBOX.addedToCheckup}
                  </p>
                )}
                {m.rating && (
                  <p className="ally-small ally-inbox__rating">
                    <span className={`ally-badge ally-inbox__rating--${m.rating}`}>
                      {m.rating === "up" ? INBOX.helpful : INBOX.notHelpful}
                    </span>
                    {m.ratingReason ? ` ${m.ratingReason.replace("_", " ")}` : ""}
                  </p>
                )}
              </li>
            </React.Fragment>
          );
        })}
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
