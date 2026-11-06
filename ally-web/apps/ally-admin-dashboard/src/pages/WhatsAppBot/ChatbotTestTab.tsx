import React, { useEffect, useRef, useState } from "react";

import { Checkbox, InlineNotification, TextArea } from "@ally-ui-mono/ui-shared";
import { useGetChatbotsQuery, useTestChatbotMutation } from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { ChatbotTestStreamUnavailable, useChatbotTestStream } from "@hooks/useChatbotTestStream";
import {
  AgentTraceStep,
  Chatbot,
  ChatbotRuntimeUsed,
  ChatbotTestStatus,
  TestChatbotResponse,
} from "@types";

import { readPreviewDraft } from "./previewDraft";
import { Card, copyToClipboard, errorMessage, fill } from "./shared";

const t = en.whatsappBot.bots.test;
/** Messages of the thread sent with each test, most recent last (ally-be keeps the same 10). */
const MAX_HISTORY_MESSAGES = 10;
const handledLabels = en.whatsappBot.conversations.handledBy as Record<string, string>;

/**
 * The checked reply arrives in one burst, so it is typed out at a reading pace: at least
 * MIN_CHARS_PER_TICK characters every REVEAL_MS (about 65 a second), faster for a long reply so
 * the whole of it never takes more than MAX_REVEAL_MS.
 */
const REVEAL_MS = 30;
const MIN_CHARS_PER_TICK = 2;
const MAX_REVEAL_MS = 4000;

type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      result?: TestChatbotResponse;
      error?: boolean;
      /** The final reply differs from the text revealed while it was made. */
      replaced?: boolean;
      /** What the agent did on the way to this reply, and how long it took. */
      activity?: ChatbotTestStatus[];
      workedMs?: number;
    };

/** The reply being made: what the agent has done so far, its steps, and the text revealed. */
interface Pending {
  activity: ChatbotTestStatus[];
  steps: AgentTraceStep[];
  text: string;
}

/**
 * A chat with the bot that sends nothing and stores nothing. It runs the same decision path as a
 * real WhatsApp message — keyword replies, then the answer with the bot's persona, documents and
 * model, with the crisis check beside it — and shows how each reply was decided.
 */
export const ChatbotTestTab: React.FC<{ bot: Chatbot }> = ({ bot }) => {
  // Unsaved changes handed over by "Preview these changes" on the Persona or Agent tab. They stay
  // stored, so those tabs still have them when the person goes back.
  const [draft] = useState(() => readPreviewDraft(bot.id));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [checkAccess, setCheckAccess] = useState(false);
  // The thread the agent keeps for this chat, until "New thread".
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [runtimeAllowed, setRuntimeAllowed] = useState(true);
  // Only platform admins see which engine answered and the run behind it, and are told when the
  // emergency switch in Defaults has every chatbot on the backup engine.
  const { data: list } = useGetChatbotsQuery();
  const isPlatformAdmin = Boolean(list?.canCreate);
  const [test] = useTestChatbotMutation();
  const stream = useChatbotTestStream();
  const [pending, setPending] = useState<Pending | null>(null);
  // The checked text that has arrived, and how much of it is on screen.
  const arrived = useRef("");
  const shownChars = useRef(0);
  // What the agent has done for the reply being made, kept for the finished reply.
  const activity = useRef<ChatbotTestStatus[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const isLoading = pending !== null;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [turns, pending]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      const full = arrived.current;
      if (shownChars.current >= full.length) return;
      const step = Math.max(
        MIN_CHARS_PER_TICK,
        Math.ceil(full.length / (MAX_REVEAL_MS / REVEAL_MS)),
      );
      shownChars.current = Math.min(full.length, shownChars.current + step);
      const text = full.slice(0, shownChars.current);
      setPending(current => current && { ...current, text });
    }, REVEAL_MS);
    return () => clearInterval(timer);
  }, [pending !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Resolves once everything that arrived is on screen (or after MAX_REVEAL_MS). */
  const revealed = () =>
    new Promise<void>(resolve => {
      const until = Date.now() + MAX_REVEAL_MS + 500;
      const check = () =>
        shownChars.current < arrived.current.length && Date.now() < until
          ? setTimeout(check, REVEAL_MS)
          : resolve();
      check();
    });

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    // The thread on screen keeps everything; the request carries only the most recent
    // messages, as WhatsApp does (the API accepts at most 20).
    const history = turns
      .slice(-MAX_HISTORY_MESSAGES)
      .map(turn => ({ role: turn.role, content: turn.content }));
    setTurns(current => [...current, { role: "user", content: text }]);
    setMessage("");
    arrived.current = "";
    shownChars.current = 0;
    activity.current = [];
    const startedAt = Date.now();
    setPending({ activity: [], steps: [], text: "" });
    const request = {
      id: bot.id,
      message: text,
      history,
      draft,
      checkAccess,
      conversationId,
    };
    try {
      let result: TestChatbotResponse;
      try {
        result = await stream.run(request, {
          onStatus: status => {
            activity.current = [...activity.current, status];
            const entries = activity.current;
            setPending(current => current && { ...current, activity: entries });
          },
          onStep: step =>
            setPending(current => current && { ...current, steps: [...current.steps, step] }),
          onToken: piece => {
            arrived.current += piece;
          },
        });
        await revealed();
      } catch (err) {
        // The stream never started: ask the plain endpoint. Once it has started, never re-send.
        if (!(err instanceof ChatbotTestStreamUnavailable)) throw err;
        result = await test(request).unwrap();
      }
      setConversationId(result.conversationId);
      setRuntimeAllowed(result.runtimeAllowed);
      // The final reply always wins: a crisis reply, a fallback or added wording replaces the text.
      const shown = arrived.current.trim();
      const replaced = Boolean(shown) && !result.reply.startsWith(shown);
      const entries = activity.current;
      setTurns(current => [
        ...current,
        {
          role: "assistant",
          content: result.reply,
          result,
          replaced,
          ...(entries.length ? { activity: entries, workedMs: Date.now() - startedAt } : {}),
        },
      ]);
    } catch (err) {
      setTurns(current => [
        ...current,
        { role: "assistant", content: errorMessage(err, t.failed), error: true },
      ]);
    } finally {
      arrived.current = "";
      shownChars.current = 0;
      setPending(null);
    }
  };

  return (
    <Card
      title={t.title}
      subtitle={t.intro}
      action={
        turns.length > 0 && (
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() => {
              stream.cancel();
              setTurns([]);
              setConversationId(undefined);
            }}
          >
            {t.newThread}
          </Button>
        )
      }
    >
      {draft && (
        <InlineNotification kind="info" title={t.draftBanner} lowContrast hideCloseButton />
      )}
      {isPlatformAdmin && !runtimeAllowed && (
        <InlineNotification kind="info" title={t.agentOff} lowContrast hideCloseButton />
      )}
      <div className="flex flex-col gap-3 min-h-[16rem] max-h-[32rem] overflow-y-auto bg-background-100 rounded-md p-4">
        {turns.length === 0 ? (
          <EmptyState title={t.empty} hideActionButton />
        ) : (
          turns.map((turn, index) => <Bubble key={index} turn={turn} showRun={isPlatformAdmin} />)
        )}
        {pending && <PendingBubble pending={pending} showSteps={isPlatformAdmin} />}
        <div ref={endRef} />
      </div>
      <div className="flex flex-col gap-2">
        <TextArea
          id="chatbot-test-message"
          labelText=""
          hideLabel
          rows={2}
          placeholder={t.placeholder}
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            id="chatbot-test-access"
            labelText={t.checkAccess}
            checked={checkAccess}
            onChange={(_e, { checked }) => setCheckAccess(checked)}
          />
          <Button
            variant={ButtonVariant.PRIMARY}
            onClick={() => void send()}
            disabled={!message.trim() || isLoading}
          >
            {t.send}
          </Button>
        </div>
      </div>
    </Card>
  );
};

/**
 * One thing the agent did, in words: "Searching the knowledge base for “getting access”",
 * "Found 2 passages in Progress, Badges and Streaks", "Rewriting: it answered before searching".
 * A second "thinking" (after a search) is the agent working out its answer.
 */
const activityLabel = (entry: ChatbotTestStatus, before?: ChatbotTestStatus): string => {
  const a = t.activity;
  const { code, detail, documents } = entry;
  switch (code) {
    case "thinking":
      return before ? a.thinkingAgain : a.thinking;
    case "searching":
      return detail ? fill(a.searchingFor, { detail }) : a.searching;
    case "found":
      if (!detail || detail === "nothing new") return a.foundNothing;
      return documents?.length
        ? fill(a.foundIn, { detail, documents: documents.join(", ") })
        : fill(a.found, { detail });
    case "rewriting": {
      const reason = detail && (a.rewriteReasons as Record<string, string>)[detail];
      return reason ? fill(a.rewritingBecause, { reason }) : a.rewriting;
    }
    default:
      return a[code] ?? entry.label;
  }
};

/**
 * What the agent did, one line each. While the reply is being made the last line is the current
 * one (animated); the lines before it are done.
 */
const ActivityFeed: React.FC<{ entries: ChatbotTestStatus[]; live: boolean }> = ({
  entries,
  live,
}) => (
  <ul className="flex flex-col gap-1 text-xs text-typography-600" data-testid="activity">
    {entries.map((entry, index) => {
      const current = live && index === entries.length - 1;
      return (
        <li
          key={`${entry.code}-${index}`}
          className="flex items-start gap-2"
          {...(current
            ? { "data-testid": "status-line", role: "status", "aria-live": "polite" }
            : {})}
        >
          <span
            aria-hidden="true"
            className={`mt-[3px] inline-block h-2 w-2 shrink-0 rounded-full ${
              current ? "bg-primary-500 animate-pulse" : "bg-typography-300"
            }`}
          />
          <span className={current ? "text-typography-900" : undefined}>
            {activityLabel(entry, index > 0 ? entries[index - 1] : undefined)}
          </span>
        </li>
      );
    })}
  </ul>
);

/** Three bouncing dots, as WhatsApp shows while someone types. */
const TypingDots: React.FC = () => (
  <span className="inline-flex items-center gap-1" aria-hidden="true">
    {[0, 1, 2].map(i => (
      <span
        key={i}
        className="h-1.5 w-1.5 rounded-full bg-typography-400 animate-bounce"
        style={{ animationDelay: `${i * 150}ms` }}
      />
    ))}
  </span>
);

/**
 * The reply while it is being made: what the agent is doing, line by line, then the checked text
 * typed out. Platform admins also see the raw steps as they finish.
 */
const PendingBubble: React.FC<{ pending: Pending; showSteps: boolean }> = ({
  pending,
  showSteps,
}) => (
  <div className="self-start max-w-[85%] flex flex-col gap-2" data-testid="pending-reply">
    {pending.activity.length > 0 ? (
      <ActivityFeed entries={pending.activity} live={!pending.text} />
    ) : (
      <div className="text-xs text-typography-500 px-1" data-testid="status-line" role="status">
        {t.activity.thinking}
      </div>
    )}
    <div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap border border-border-light bg-white text-typography-900">
      {pending.text ? (
        <span data-testid="revealed-text">
          {pending.text}
          <span className="animate-pulse">▍</span>
        </span>
      ) : (
        <TypingDots />
      )}
    </div>
    {showSteps && pending.steps.length > 0 && (
      <ol className="list-decimal pl-6 text-xs text-typography-500" data-testid="live-steps">
        {pending.steps.map((step, index) => (
          <li key={`${step.node}-${index}`}>{stepLine(step)}</li>
        ))}
      </ol>
    )}
  </div>
);

/** One message. `showRun`: the engine and the run behind an answer, for platform admins only. */
const Bubble: React.FC<{ turn: Turn; showRun: boolean }> = ({ turn, showRun }) => {
  if (turn.role === "user") {
    return (
      <div className="self-end max-w-[80%] rounded-lg bg-primary-500 text-white px-3 py-2 text-sm whitespace-pre-wrap">
        {turn.content}
      </div>
    );
  }
  const result = turn.result;
  const model = result?.retrieval?.model as string | undefined;
  return (
    <div className="self-start max-w-[85%] flex flex-col gap-1">
      {turn.activity && (
        <details className="text-xs text-typography-500 px-1" data-testid="worked">
          <summary className="cursor-pointer">
            {fill(t.activity.worked, {
              seconds: ((turn.workedMs ?? 0) / 1000).toFixed(1),
              count: turn.activity.length,
            })}
          </summary>
          <div className="pt-1">
            <ActivityFeed entries={turn.activity} live={false} />
          </div>
        </details>
      )}
      <div
        className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap border ${
          turn.error
            ? "border-destructive-300 bg-destructive-50 text-typography-900"
            : "border-border-light bg-white text-typography-900"
        }`}
      >
        {turn.content}
      </div>
      {result && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-typography-500 px-1">
          <span>
            {t.handledBy}: {handledLabels[result.handledBy] ?? result.handledBy}
          </span>
          {model && (
            <span>
              {t.model}: {model}
            </span>
          )}
          <span>{result.latencyMs} ms</span>
          {showRun ? (
            <EngineBadge result={result} />
          ) : (
            result.runtime === "v2_fallback" && (
              <span data-testid="fallback-note">{t.fellBackPlain}</span>
            )
          )}
          {result.turnType && (
            <span data-testid="turn-type" className="rounded-full border border-border-light px-2">
              {t.turnTypes[result.turnType] ?? result.turnType}
            </span>
          )}
          {result.citations.length > 0 && (
            <span>
              {t.sources}: {[...new Set(result.citations.map(c => c.document_title))].join(", ")}
            </span>
          )}
          {turn.replaced && <span data-testid="replaced-note">{t.replaced}</span>}
          {result.wouldFileUnanswered && <span>{t.wouldFile}</span>}
          {result.wouldAlert && (
            <span className="text-destructive-600">
              {fill(t.wouldAlert, { type: result.wouldAlert })}
            </span>
          )}
        </div>
      )}
      {showRun && result?.runId && <RunDetails result={result} />}
    </div>
  );
};

/**
 * One step as a line: its summary when it has one (counts only, e.g. "retrieve: 3 hits, best
 * 0.71"), else its name; a tool call is marked as one. Then its time.
 */
const stepLine = (step: AgentTraceStep): string => {
  const what = step.summary || step.node;
  return `${step.node === "tool" ? `${t.toolStep} · ` : ""}${what} · ${step.ms} ms`;
};

const ENGINE_TONE: Record<ChatbotRuntimeUsed, string> = {
  v2: "border-primary-300 text-primary-700",
  v2_fallback: "border-warning-300 text-warning-700",
  v1: "border-border-light text-typography-600",
};

/** Who answered this test: the agent, or the backup engine (and why, when the agent failed). */
const EngineBadge: React.FC<{ result: TestChatbotResponse }> = ({ result }) => {
  const label = {
    v2: t.answeredByAgent,
    v2_fallback: fill(t.fellBack, { reason: result.fallbackReason ?? "unknown" }),
    v1: t.answeredByBackup,
  }[result.runtime];
  return (
    <span
      data-testid="engine-badge"
      className={`rounded-full border px-2 ${ENGINE_TONE[result.runtime]}`}
    >
      {label}
    </span>
  );
};

/** The run behind an agent answer: its id, to find it later, and the steps it took. */
const RunDetails: React.FC<{ result: TestChatbotResponse }> = ({ result }) => {
  const steps = result.trace ?? [];
  return (
    <div className="flex flex-col gap-1 text-xs text-typography-500 px-1">
      <div className="flex items-center gap-2">
        <span>{t.runId}:</span>
        <code className="break-all">{result.runId}</code>
        <button
          type="button"
          className="text-primary-600 hover:underline"
          onClick={() => void copyToClipboard(result.runId ?? "")}
        >
          {t.copy}
        </button>
      </div>
      {steps.length > 0 && (
        <details>
          <summary className="cursor-pointer">{fill(t.steps, { count: steps.length })}</summary>
          <ol className="list-decimal pl-5 pt-1">
            {steps.map((step, index) => (
              <li key={`${step.node}-${index}`}>{stepLine(step)}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
};
