import { useEffect, useRef, useState } from "react";

import {
  Avatar,
  ErrorText,
  PageHeader,
  Sources,
  TextButton,
  TypingDots,
} from "../components/parts";
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader branding={branding} subtitle={statusLine}>
        <TextButton onClick={onNewChat} disabled={busy || (!messages.length && !pending)}>
          {copy.chat.newChat}
        </TextButton>
      </PageHeader>
      {signedInAs && (
        <p className="bg-stone-100 px-4 py-1 text-center text-xs text-stone-600">
          {fill(copy.chat.signedInAs, { email: signedInAs })}
        </p>
      )}

      <main
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        <ol className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.map(m =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--bp-accent)] px-4 py-2 text-[var(--bp-on-accent)]">
                  <span className="sr-only">{copy.chat.you}: </span>
                  {m.text}
                </p>
              </li>
            ) : (
              <li key={m.id} className="flex items-end gap-2">
                <Avatar branding={branding} size={28} />
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2 shadow-sm">
                  <span className="sr-only">{branding.assistantName}: </span>
                  <p className="whitespace-pre-wrap text-stone-900">{m.text}</p>
                  <Sources citations={m.citations} copy={copy} />
                </div>
              </li>
            ),
          )}
          {pending && (
            <li className="flex items-end gap-2">
              <Avatar branding={branding} size={28} />
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2 shadow-sm">
                {pending.text ? (
                  <p className="whitespace-pre-wrap text-stone-900">
                    {pending.text}
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-stone-400 align-middle motion-reduce:animate-none"
                    />
                  </p>
                ) : (
                  <TypingDots label={copy.chat.status[pending.status ?? "thinking"]} />
                )}
              </div>
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </main>

      <p role="status" className="min-h-[1.25rem] px-4 text-center text-xs text-stone-500">
        {pending && !pending.text && pending.status ? copy.chat.status[pending.status] : ""}
      </p>

      {!messages.length && !pending && page.suggestedQuestions.length > 0 && (
        <div className="mx-auto w-full max-w-2xl px-4 pb-2">
          <p className="mb-2 text-xs font-semibold text-stone-500">{copy.chat.suggested}</p>
          <div className="flex flex-wrap gap-2">
            {page.suggestedQuestions.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                disabled={busy}
                className="min-h-[44px] rounded-full border border-[var(--bp-accent)] px-4 text-left text-sm text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bp-accent)]"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <form
        className="mx-auto w-full max-w-2xl border-t border-stone-200 bg-white px-4 py-3"
        onSubmit={e => {
          e.preventDefault();
          send(draft);
        }}
      >
        <ErrorText>{error}</ErrorText>
        <div className="flex items-end gap-2">
          <label htmlFor="bp-message" className="sr-only">
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
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-base focus:border-[var(--bp-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--bp-accent)]"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim() || tooLong}
            className="min-h-[44px] rounded-lg bg-[var(--bp-accent)] px-4 font-semibold text-[var(--bp-on-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bp-accent)] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {copy.chat.send}
          </button>
        </div>
        <p
          id="bp-count"
          className={`mt-1 text-right text-xs ${tooLong ? "text-red-700" : "text-stone-400"}`}
        >
          {draft.length > page.maxMessageChars * 0.8
            ? fill(copy.chat.tooLong, { count: draft.length, max: page.maxMessageChars })
            : ""}
        </p>
      </form>
    </div>
  );
}
