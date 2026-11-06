import React, { useEffect, useRef, useState } from "react";

import { Checkbox, InlineNotification, TextArea } from "@ally-ui-mono/ui-shared";
import { useGetChatbotsQuery, useTestChatbotMutation } from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { AgentTraceStep, Chatbot, TestChatbotResponse } from "@types";

import { takePreviewDraft } from "./previewDraft";
import { Card, copyToClipboard, errorMessage, fill } from "./shared";

const t = en.whatsappBot.bots.test;
/** Messages of the thread sent with each test, most recent last (ally-be keeps the same 10). */
const MAX_HISTORY_MESSAGES = 10;
const handledLabels = en.whatsappBot.conversations.handledBy as Record<string, string>;

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; result?: TestChatbotResponse; error?: boolean };

/**
 * A chat with the bot that sends nothing and stores nothing. It runs the same decision path as a
 * real WhatsApp message — keyword replies, then the answer with the bot's persona, documents and
 * model, with the crisis check beside it — and shows how each reply was decided.
 */
export const ChatbotTestTab: React.FC<{ bot: Chatbot }> = ({ bot }) => {
  // Unsaved changes handed over by "Preview these changes" on the Persona or Agent tab.
  const [draft] = useState(() => takePreviewDraft(bot.id));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [checkAccess, setCheckAccess] = useState(false);
  // The thread the agent keeps for this chat, until "New thread".
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [runtimeAllowed, setRuntimeAllowed] = useState(true);
  // Only platform admins are told when the emergency switch in Defaults has every chatbot on the
  // backup engine.
  const { data: list } = useGetChatbotsQuery();
  const isPlatformAdmin = Boolean(list?.canCreate);
  const [test, { isLoading }] = useTestChatbotMutation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [turns]);

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
    try {
      const result = await test({
        id: bot.id,
        message: text,
        history,
        draft,
        checkAccess,
        conversationId,
      }).unwrap();
      setConversationId(result.conversationId);
      setRuntimeAllowed(result.runtimeAllowed !== false);
      setTurns(current => [...current, { role: "assistant", content: result.reply, result }]);
    } catch (err) {
      setTurns(current => [
        ...current,
        { role: "assistant", content: errorMessage(err, t.failed), error: true },
      ]);
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
          turns.map((turn, index) => <Bubble key={index} turn={turn} />)
        )}
        {isLoading && (
          <div className="self-start rounded-lg px-3 py-2 text-sm border border-border-light bg-white text-typography-500">
            {t.thinking}
          </div>
        )}
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

const Bubble: React.FC<{ turn: Turn }> = ({ turn }) => {
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
          <EngineBadge result={result} />
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
          {result.wouldFileUnanswered && <span>{t.wouldFile}</span>}
          {result.wouldAlert && (
            <span className="text-destructive-600">
              {fill(t.wouldAlert, { type: result.wouldAlert })}
            </span>
          )}
        </div>
      )}
      {result?.runId && <RunDetails result={result} />}
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

/** Who answered this test: the agent, or the backup engine (and why, when the agent failed). */
const EngineBadge: React.FC<{ result: TestChatbotResponse }> = ({ result }) => {
  const runtime = result.runtime ?? "v1";
  const label =
    runtime === "v2"
      ? t.answeredByAgent
      : runtime === "v2_fallback"
        ? fill(t.fellBack, { reason: result.fallbackReason ?? "unknown" })
        : t.answeredByBackup;
  const tone =
    runtime === "v2"
      ? "border-primary-300 text-primary-700"
      : runtime === "v2_fallback"
        ? "border-warning-300 text-warning-700"
        : "border-border-light text-typography-600";
  return (
    <span data-testid="engine-badge" className={`rounded-full border px-2 ${tone}`}>
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
