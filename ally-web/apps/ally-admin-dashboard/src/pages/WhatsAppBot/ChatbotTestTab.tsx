import React, { useEffect, useRef, useState } from "react";

import { Checkbox, InlineNotification, TextArea } from "@ally-ui-mono/ui-shared";
import { useTestChatbotMutation } from "@api";
import { Button, EmptyState } from "@components";
import { ButtonVariant } from "@components/types";
import { en } from "@constants";
import { Chatbot, ChatbotDraft, TestChatbotResponse } from "@types";

import { Card, errorMessage, fill } from "./shared";

import type { PersonaDraft } from "./PersonaTab";

const t = en.whatsappBot.bots.test;
const handledLabels = en.whatsappBot.conversations.handledBy as Record<string, string>;

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; result?: TestChatbotResponse; error?: boolean };

/** Unsaved persona changes handed over by the Persona tab's "Try these changes", read once. */
const takeDraft = (botId: string): ChatbotDraft | undefined => {
  try {
    const raw = sessionStorage.getItem(`chatbot-draft:${botId}`);
    if (!raw) return undefined;
    sessionStorage.removeItem(`chatbot-draft:${botId}`);
    const draft = JSON.parse(raw) as PersonaDraft;
    return { persona: draft.persona, answerMode: draft.answerMode, model: draft.model };
  } catch {
    return undefined;
  }
};

/**
 * A chat with the bot that sends nothing and stores nothing. It runs the same decision path as a
 * real WhatsApp message — keyword replies, then the answer with the bot's persona, documents and
 * model, with the crisis check beside it — and shows how each reply was decided.
 */
export const ChatbotTestTab: React.FC<{ bot: Chatbot }> = ({ bot }) => {
  const [draft] = useState(() => takeDraft(bot.id));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [checkAccess, setCheckAccess] = useState(false);
  const [test, { isLoading }] = useTestChatbotMutation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [turns]);

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    const history = turns.map(turn => ({ role: turn.role, content: turn.content }));
    setTurns(current => [...current, { role: "user", content: text }]);
    setMessage("");
    try {
      const result = await test({
        id: bot.id,
        message: text,
        history,
        draft,
        checkAccess,
      }).unwrap();
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
          <Button variant={ButtonVariant.SECONDARY} onClick={() => setTurns([])}>
            {t.reset}
          </Button>
        )
      }
    >
      {draft && (
        <InlineNotification kind="info" title={t.draftBanner} lowContrast hideCloseButton />
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
    </div>
  );
};
