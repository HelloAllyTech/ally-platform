import React, { useEffect, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import {
  fadeUpVariants,
  listStaggerDelay,
  motionTransition,
  useReducedMotionPreference,
} from "../../../motion";
import { DictationButton } from "../components/DictationButton";
import { shakeAnimation } from "../components/FlowMotion";
import { typeInText } from "../hooks/useDictation";
import { PendingSend } from "../hooks/useOutbox";

import type { RoadmapDraftMessage } from "../../../types/roadmapV2Flow";

export type TurnError = "unavailable" | "ceiling" | "other" | null;

interface DraftConversationProps {
  code?: string;
  messages: RoadmapDraftMessage[];
  pending: PendingSend[];
  running: boolean;
  turnError: TurnError;
  onRetryTurn: () => void;
  onRetrySend: (key: string) => void;
  onAnswer: (text: string) => void;
  onCheck: () => void;
  readOnly: boolean;
  /** An answer a check quoted: it glows like the quote in the idea box. */
  glowMessageId?: { id: string; token: number } | null;
  large?: boolean;
}

/** "Thinking · 12 s", counting only while the turn runs (§4.12). Dots breathe, unless reduced. */
export const ThinkingLine: React.FC<{ label?: (s: number) => string }> = ({ label }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.draft;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-typography-secondary"
      role="status"
    >
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="block h-1.5 w-1.5 rounded-full bg-typography-secondary"
            animate={reduced ? { opacity: 0.6 } : { opacity: [0.3, 1, 0.3] }}
            transition={
              reduced ? { duration: 0 } : { duration: 1.2, repeat: Infinity, delay: i * 0.2 }
            }
          />
        ))}
      </span>
      {(label ?? copy.thinking)(seconds)}
    </span>
  );
};

/**
 * The idea interview on the draft page (§4.2): the agent's questions and your answers, oldest
 * first; the answer box with 🎤. Answers show at once, "sending…" until the server has them, and
 * wait on the device offline (§4.17). A failed turn says so inline with Retry; nothing typed is lost.
 */
export const DraftConversation: React.FC<DraftConversationProps> = ({
  code,
  messages,
  pending,
  running,
  turnError,
  onRetryTurn,
  onRetrySend,
  onAnswer,
  onCheck,
  readOnly,
  glowMessageId,
  large,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.draft;
  const [answer, setAnswer] = useState("");
  const list = Array.isArray(messages) ? messages : [];
  const sentKeys = new Set(list.map(m => m.idempotencyKey).filter(Boolean));
  const waiting = pending.filter(p => !sentKeys.has(p.idempotencyKey));

  const send = () => {
    const text = answer.trim();
    if (!text) return;
    onAnswer(text);
    setAnswer("");
  };

  return (
    <section aria-label={copy.conversation} className="flex flex-col gap-3">
      <h2 className="m-0 text-sm font-semibold text-typography-primary">{copy.conversation}</h2>
      {list.length === 0 && !running && !readOnly && (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-typography-secondary">{copy.checkMyIdeaHelp}</p>
          <Button kind="primary" size={large ? "lg" : "md"} onClick={onCheck}>
            {copy.checkMyIdea}
          </Button>
        </div>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite">
        <AnimatePresence initial={false}>
          {list.map((message, index) => (
            <motion.li
              key={message.id}
              className="flex flex-col gap-0.5"
              {...fadeUpVariants(reduced, 8)}
              transition={{
                ...motionTransition("moderate", "productive", reduced),
                delay: listStaggerDelay(index % 8, reduced) * (40 / 30),
              }}
              data-message={message.id}
            >
              <span className="text-xs font-semibold text-typography-secondary">
                {message.from === "agent" ? copy.agentName : copy.you}
              </span>
              <p className="relative m-0 whitespace-pre-wrap text-sm text-typography-primary">
                {glowMessageId?.id === message.id && (
                  <motion.span
                    key={glowMessageId.token}
                    className="pointer-events-none absolute -inset-1 rounded bg-warning-200"
                    initial={{ opacity: 0.9 }}
                    animate={{ opacity: reduced ? [0.9, 0.9, 0] : 0 }}
                    transition={
                      reduced
                        ? { duration: 1.2, times: [0, 0.99, 1] }
                        : { duration: 1.2, ease: "easeOut" }
                    }
                    aria-hidden
                  />
                )}
                <span className="relative">{message.text}</span>
              </p>
              {message.wrapUp && (
                <span className="text-xs text-typography-secondary">{copy.wrapUpNote}</span>
              )}
            </motion.li>
          ))}
          {waiting.map(item => (
            <motion.li
              key={item.idempotencyKey}
              className="flex flex-col gap-0.5"
              initial={{ opacity: 0 }}
              animate={{
                opacity: item.state === "sending" ? 0.6 : 1,
                ...shakeAnimation(reduced, item.state === "failed"),
              }}
              transition={motionTransition(
                item.state === "failed" ? "fast" : "instant",
                "productive",
                reduced,
              )}
            >
              <span className="text-xs font-semibold text-typography-secondary">{copy.you}</span>
              <p className="m-0 whitespace-pre-wrap text-sm text-typography-primary">{item.text}</p>
              <span className="flex items-center gap-2 text-xs text-typography-secondary">
                {item.state === "sending" && copy.sending}
                {item.state === "offline" && copy.offlineAnswer}
                {item.state === "failed" && (
                  <>
                    {copy.assistantUnavailable}
                    <button
                      type="button"
                      className="text-primary-700 hover:underline"
                      onClick={() => onRetrySend(item.idempotencyKey)}
                    >
                      {copy.retry}
                    </button>
                  </>
                )}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {running && <ThinkingLine />}
      {turnError && !running && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span className="text-typography-primary">
            {turnError === "ceiling" ? copy.ceilingReached : copy.assistantUnavailable}
          </span>
          {turnError !== "ceiling" && (
            <Button kind="ghost" size="sm" onClick={onRetryTurn}>
              {copy.retry}
            </Button>
          )}
        </div>
      )}
      {list.length > 0 && !readOnly && (
        <div className="flex flex-col gap-2">
          <TextArea
            id={`roadmap-draft-answer-${code ?? "new"}`}
            labelText={copy.answerLabel}
            hideLabel
            value={answer}
            rows={1}
            placeholder={copy.answerPlaceholder}
            onChange={event => setAnswer(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <DictationButton
              code={code}
              boxLabel={copy.answerLabel}
              large={large}
              onText={words => {
                typeInText(answer, words, setAnswer, reduced);
              }}
            />
            <Button kind="primary" size="sm" onClick={send} disabled={!answer.trim()}>
              {copy.send}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
