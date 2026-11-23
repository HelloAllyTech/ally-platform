import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextInput } from "@ally-ui-mono/ui-shared";
import {
  useGetPmConversationQuery,
  useLazyGetPmConversationQuery,
  useSendPmMessageMutation,
} from "@api";
import { en } from "@constants";
import { PmAbout, PmMessage } from "@types";
import { getErrorMessage } from "@utils";

const ACTION_TONE: Record<string, string> = {
  done: "bg-success-50 text-success-600",
  awaiting_yes: "bg-[#FFF2E8] text-[#8A3800]",
  failed: "bg-destructive-50 text-destructive-600",
};

/** What a message chip says it did: "Done: …", "Waiting for your yes: …". */
export const actionText = (action: NonNullable<PmMessage["action"]>): string => {
  const words = en.debriefs.v2.conversation.action[action.status];
  return words ? words(action.label) : action.label;
};

const Message: React.FC<{ m: PmMessage; pending?: boolean; hideAbout?: boolean }> = ({
  m,
  pending,
  hideAbout,
}) => {
  const c = en.debriefs.v2.conversation;
  const person = m.who === "person";
  const who = person ? (m.author ?? c.you) : c.agent;
  return (
    <div
      data-testid="pm-message"
      data-who={m.who}
      data-pending={pending ? "true" : undefined}
      className={`flex max-w-[75%] flex-col gap-1 ${person ? "self-end" : "self-start"}`}
    >
      <span className="text-xs text-neutral-600">
        {who}
        {m.about && !hideAbout ? ` · ${c.about(m.about.label)}` : ""}
      </span>
      <div
        className={`whitespace-pre-wrap px-3.5 py-2.5 text-sm leading-normal ${person ? "bg-primary-50" : "bg-neutral-50"}`}
      >
        {m.text}
      </div>
      {m.action && (
        <span
          data-testid="pm-message-action"
          data-status={m.action.status}
          className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTION_TONE[m.action.status] ?? ""}`}
        >
          {actionText(m.action)}
        </span>
      )}
    </div>
  );
};

/**
 * The one PM agent conversation (v2 C1–C3): the same thread on Home and on Changes. Each message
 * notes what it was about; "Looking at" says what this message will be about. The agent replies
 * and acts (approve after an explicit yes, stop, undo, retry, hold a language…), and its reply
 * carries the action it took.
 */
export const PmConversation: React.FC<{
  about: PmAbout;
  placeholder?: string;
  suggestions?: string[];
  testId?: string;
  /** Shown on the right of the heading row (Home: "Open with changes"). */
  headerAction?: React.ReactNode;
  className?: string;
  /**
   * A change's own thread inside Home › Needs you: only the messages about `about`, headed
   * "PM agent · about this change", no "Looking at" (it is always this change).
   */
  scoped?: boolean;
}> = ({ about, placeholder, suggestions = [], testId, headerAction, className, scoped }) => {
  const c = en.debriefs.v2.conversation;
  const scopeId = scoped && about.kind === "change" ? about.id : undefined;
  const q = useGetPmConversationQuery(scopeId ? { about: scopeId } : undefined);
  const [loadEarlier, earlierState] = useLazyGetPmConversationQuery();
  const [older, setOlder] = useState<PmMessage[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [send, sending] = useSendPmMessageMutation();
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState<PmMessage | null>(null);

  const recent = q.data?.messages ?? [];
  const seen = new Set(recent.map(m => m.id));
  const all = [...older.filter(m => !seen.has(m.id)), ...recent];
  const messages = scoped
    ? all.filter(m => m.about?.kind === about.kind && m.about?.id === about.id)
    : all;
  const more = olderMore ?? q.data?.more ?? false;

  const submit = async (raw: string) => {
    const body = raw.trim();
    if (!body || sending.isLoading) return;
    setText("");
    setWaiting({
      id: "pending",
      at: new Date().toISOString(),
      who: "person",
      author: null,
      text: body,
      about,
      action: null,
    });
    try {
      await send({ text: body, about }).unwrap();
    } catch (e) {
      setText(body);
      toast.error(getErrorMessage(e, c.sendFailed));
    } finally {
      setWaiting(null);
    }
  };

  const earlier = async () => {
    const first = messages[0];
    if (!first) return;
    try {
      const page = await loadEarlier({ before: first.id, limit: 50, about: scopeId }).unwrap();
      setOlder(o => [...page.messages, ...o]);
      setOlderMore(page.more);
    } catch (e) {
      toast.error(getErrorMessage(e, c.loadFailed));
    }
  };

  return (
    <section
      aria-label={c.heading}
      data-testid={testId ?? "pm-conversation"}
      className={`flex min-w-0 flex-col ${className ?? ""}`}
    >
      <div className="flex flex-nowrap items-center gap-3 border-b border-neutral-100 px-[18px] py-3">
        {scoped ? (
          <h3 className="m-0 shrink-0 text-xs font-normal text-neutral-600">{c.aboutThisChange}</h3>
        ) : (
          <h2 className="m-0 shrink-0 text-base font-semibold">{c.heading}</h2>
        )}
        {headerAction && <div className="ml-auto shrink-0">{headerAction}</div>}
      </div>
      <div className="flex flex-col gap-3 px-[18px] py-3.5" data-testid="pm-thread">
        {more && (
          <button
            type="button"
            className="self-center text-sm text-primary-500 underline"
            disabled={earlierState.isFetching}
            onClick={() => void earlier()}
          >
            {c.earlier}
          </button>
        )}
        {q.isError && !q.data ? (
          <p className="m-0 text-sm text-neutral-700" data-testid="pm-thread-error">
            {c.loadFailed}{" "}
            <button
              type="button"
              className="text-primary-500 underline"
              onClick={() => void q.refetch()}
            >
              {c.retry}
            </button>
          </p>
        ) : q.data && messages.length === 0 && !waiting ? (
          <p className="m-0 text-sm text-neutral-600" data-testid="pm-thread-empty">
            {c.empty}
          </p>
        ) : null}
        {messages.map(m => (
          <Message key={m.id} m={m} hideAbout={scoped} />
        ))}
        {waiting && (
          <>
            <Message m={waiting} pending hideAbout={scoped} />
            <p className="m-0 self-start text-xs text-neutral-600" data-testid="pm-replying">
              {c.sending}
            </p>
          </>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-[18px] pb-3" data-testid="pm-suggestions">
          {suggestions.map(sug => (
            <button
              key={sug}
              type="button"
              disabled={sending.isLoading}
              onClick={() => void submit(sug)}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-[13px] text-neutral-800 hover:bg-neutral-50"
            >
              {sug}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-neutral-100 px-[18px] py-3">
        <div
          className={`min-w-0 flex-nowrap items-center gap-2 text-[13px] ${scoped ? "hidden" : "flex"}`}
        >
          <span className="shrink-0 text-neutral-600">{c.lookingAt}</span>
          <span
            data-testid="pm-looking-at"
            title={about.label}
            className="min-w-0 truncate rounded-full bg-neutral-100 px-2.5 py-0.5 text-neutral-900"
          >
            {about.label}
          </span>
        </div>
        <form
          className="flex flex-nowrap items-end gap-2"
          onSubmit={e => {
            e.preventDefault();
            void submit(text);
          }}
        >
          <div className="min-w-0 flex-1">
            <TextInput
              id={`${testId ?? "pm-conversation"}-input`}
              labelText={scoped ? c.replyLabel : c.inputLabel}
              hideLabel
              placeholder={placeholder ?? (scoped ? c.replyPlaceholder : c.placeholder)}
              value={text}
              disabled={sending.isLoading}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
            />
          </div>
          <Button
            kind="primary"
            size="md"
            type="button"
            disabled={sending.isLoading || !text.trim()}
            onClick={() => void submit(text)}
          >
            {c.send}
          </Button>
        </form>
      </div>
    </section>
  );
};
