import React, { useEffect, useRef, useState } from "react";

import { ArrowDown, DoubleArrowRight } from "@icons";

import { en } from "@constants";
import { BuilderNowSession } from "@types";

import { sessionCode } from "./roomFormat";
import { useDraft } from "./useRoomEnvironment";

const strings = en.builder.room.composer;

export type ComposerMode = "ask" | "tell";

/** Where a Tell will land, said before it is sent. */
export const tellRouteNote = (session: BuilderNowSession | undefined): string => {
  if (!session) return "";
  if (session.status === "INTERVIEWING" || session.status === "PRD_READY") {
    return strings.route.interview;
  }
  if (session.waitingOn === "stuck") return strings.route.stuck;
  if (session.waitingOn === "review") return strings.route.review;
  return strings.route.queued(session.runSequence);
};

/** Apply now is only offered where there is a run to restart. */
const canApplyNow = (session: BuilderNowSession | undefined): boolean =>
  Boolean(session && session.status === "BUILDING" && session.runSequence);

interface ComposerProps {
  sessions: BuilderNowSession[];
  targetId: string | null;
  onTarget: (sessionId: string) => void;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  busy: boolean;
  showKeys: boolean;
  /** On a phone the composer lives in a sheet and closes after sending. */
  variant: "inline" | "sheet";
  focusSignal: number;
  prefill: { text: string; nonce: number } | null;
  onAsk: (sessionId: string, text: string) => Promise<boolean>;
  onTell: (sessionId: string, text: string, applyNow: boolean) => Promise<boolean>;
}

/**
 * Ask and Tell: one box, two verbs, and a target you can always see. Enter
 * asks; ⌘Enter (or the Tell switch, which is how a phone says it) tells — and
 * a Tell says where it will land before you send it, so an instruction never
 * goes somewhere you didn't expect.
 */
export const Composer: React.FC<ComposerProps> = ({
  sessions,
  targetId,
  onTarget,
  mode,
  onMode,
  busy,
  showKeys,
  variant,
  focusSignal,
  prefill,
  onAsk,
  onTell,
}) => {
  const [text, setText] = useDraft(targetId ? `composer:${targetId}` : null);
  const [modifier, setModifier] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const target = sessions.find(session => session.id === targetId);
  const code = target ? sessionCode(target) : "";
  const telling = mode === "tell" || modifier;

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  const submit = async (tell: boolean, applyNow = false) => {
    const value = text.trim();
    if (!value || !targetId || busy) return;
    const ok = tell ? await onTell(targetId, value, applyNow) : await onAsk(targetId, value);
    if (ok) setText("");
  };

  if (!sessions.length) {
    return <p className="text-sm text-typography-500">{strings.nothing}</p>;
  }

  return (
    <div className={variant === "sheet" ? "flex flex-col gap-3" : "flex flex-col gap-2"}>
      {telling && target && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-typography-600">
          <DoubleArrowRight className="h-3.5 w-3.5" aria-hidden />
          <span>{tellRouteNote(target)}</span>
          {canApplyNow(target) && (
            <button
              type="button"
              className="text-typography-600 underline underline-offset-2"
              disabled={busy || !text.trim()}
              onClick={() => submit(true, true)}
            >
              {strings.applyNow}
            </button>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative inline-flex h-10 items-center gap-1 border border-neutral-500 bg-neutral-100 pl-2 pr-6 text-xs sm:h-8">
          <span>{strings.to}</span>
          <span className="sr-only">{strings.target}</span>
          <select
            className="max-w-[9rem] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
            value={targetId ?? ""}
            onChange={event => onTarget(event.target.value)}
          >
            {sessions.map(session => (
              <option key={session.id} value={session.id}>
                {sessionCode(session)} · {session.title.slice(0, 40)}
              </option>
            ))}
          </select>
          <ArrowDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5" aria-hidden />
        </label>
        <span
          className="inline-flex h-10 border border-neutral-500 sm:h-8"
          role="group"
          aria-label="Ask or tell"
        >
          {(["ask", "tell"] as ComposerMode[]).map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={(value === "tell") === telling}
              onClick={() => {
                onMode(value);
                inputRef.current?.focus();
              }}
              className={[
                "px-3 text-sm",
                (value === "tell") === telling
                  ? "bg-typography-900 text-white"
                  : "text-typography-600",
              ].join(" ")}
            >
              {value === "ask" ? strings.ask : strings.tell}
            </button>
          ))}
        </span>
        <label className="sr-only" htmlFor="room-composer">
          {telling ? strings.tellPlaceholder(code) : strings.askPlaceholder(code)}
        </label>
        <textarea
          id="room-composer"
          ref={inputRef}
          rows={1}
          value={text}
          disabled={busy}
          onChange={event => setText(event.target.value)}
          placeholder={telling ? strings.tellPlaceholder(code) : strings.askPlaceholder(code)}
          onKeyDown={event => {
            if (event.key === "Meta" || event.key === "Control") setModifier(true);
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit(event.metaKey || event.ctrlKey || mode === "tell");
            }
            if (event.key === "Escape") (event.target as HTMLElement).blur();
          }}
          onKeyUp={event => {
            if (event.key === "Meta" || event.key === "Control") setModifier(false);
          }}
          onBlur={() => setModifier(false)}
          className={[
            "min-w-0 resize-none border-0 border-b border-neutral-500 bg-neutral-100 px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 sm:text-sm",
            variant === "sheet" ? "order-3 h-12 basis-full" : "h-10 flex-1 basis-[180px] sm:h-8",
          ].join(" ")}
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => submit(telling)}
          className={[
            "inline-flex h-10 items-center gap-1.5 border border-typography-900 px-3 text-sm disabled:opacity-50 sm:h-8",
            variant === "sheet" ? "order-4 ml-auto" : "",
          ].join(" ")}
        >
          {telling ? strings.tell : strings.ask}
          {showKeys && (
            <kbd className="font-mono text-[11px]">{telling && mode !== "tell" ? "⌘⏎" : "⏎"}</kbd>
          )}
        </button>
      </div>
    </div>
  );
};
