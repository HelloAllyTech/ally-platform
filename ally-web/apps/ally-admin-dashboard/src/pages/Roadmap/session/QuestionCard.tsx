import React, { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { Button, TextArea } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { useUser } from "@hooks";
import type { BuilderQuestionEvent, RoadmapItemDetail, RoadmapPersonRef } from "@types";

import { useRoadmapPresence, useTypingIn } from "./presenceContext";
import { SessionAnswers } from "./useSessionAnswers";
import { haptic, motionTransition, useReducedMotionPreference } from "../../../motion";
import { BottomSheet } from "../components/BottomSheet";
import { CodeText } from "../components/CodeChip";
import { DictationButton } from "../components/DictationButton";
import { DrawnCheck, shakeAnimation } from "../components/FlowMotion";
import { typeInText } from "../hooks/useDictation";
import { PendingSend } from "../hooks/useOutbox";
import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { useRoadmapJobTimer } from "../hooks/useRoadmapJobTimer";
import { isTypingTarget } from "../utils/keyboard";

import type { RoadmapConversationPost, RoadmapQuestionAnswers } from "../../../types/roadmapV2Flow";

/** Options get keys 1–9 (§4.10); a tenth option and beyond are buttons only. */
const KEYED_OPTIONS = 9;

const roleWord = (person: RoadmapPersonRef): string => {
  const people = en.roadmapV2.people;
  return person.relation
    ? (people.relations[person.relation] ?? "")
    : (people.roles[person.role] ?? "");
};

/** What a post says, with option ids turned into their labels when the text is empty. */
const postText = (post: RoadmapConversationPost, options?: { id: string; label: string }[]) => {
  if (post.text) return post.text;
  const labels = (post.optionIds ?? [])
    .map(id => options?.find(o => o.id === id)?.label)
    .filter(Boolean);
  return labels.join(", ");
};

interface QuestionCardProps {
  question: BuilderQuestionEvent;
  /** The answer the old single-writer transcript recorded, if any (before P3b). */
  legacyAnswer?: string;
  item: RoadmapItemDetail;
  session: SessionAnswers;
  agentName: string;
  /** The newest open question: 1–9 answer it even before you click into it. */
  latest?: boolean;
}

/**
 * A question card with its own answer box (§4.5a, D13). Anyone with Roadmap access can answer;
 * every answer shows who gave it. If answers conflict, the card says "Waiting for Priya to choose"
 * and only the settler (or an Owner) sees Use this answer on each — the agent never chooses.
 *
 * Options are buttons 1–9 on a desktop and full-width buttons on a phone; free text on a phone
 * opens a sheet with a 56 px mic, so a voice answer takes two taps (§4.17).
 *
 * Motion (§4.18): an answered card condenses into one line with a ✓ drawing in; a second answer
 * slides in below the first and "Waiting for … to choose" fades in; the chosen answer gets a ✓ and
 * a highlight wash while the others dim to 60%; "Ana is answering…" fades in while she types.
 */
export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  legacyAnswer,
  item,
  session,
  agentName,
  latest = false,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.session;
  const { user } = useUser();
  const breakpoint = useRoadmapBreakpoint();
  const isPhone = breakpoint === "phone";
  const { announceTyping } = useRoadmapPresence();
  const typing = useTypingIn(question.id);

  const state: RoadmapQuestionAnswers | undefined = session.questions.get(question.id);
  const answers = state?.answers ?? [];
  const pending = session.pending.filter(p => p.kind === "answer" && p.questionId === question.id);
  const options = Array.isArray(question.options) ? question.options : (state?.options ?? []);
  const canAnswer = !!item.can?.answer && session.enabled;
  const isSettler = (!!state?.settler && state.settler.id === user?.id) || !!item.can?.settleAnswer;
  const mine = answers.find(a => a.by.id === user?.id);
  const chosen = state?.chosenPostId ?? null;
  const conflict = !!state?.conflict && !chosen;
  const hasAnswers = answers.length > 0 || !!legacyAnswer;

  const [expanded, setExpanded] = useState(false);
  const condensed = hasAnswers && !conflict && !expanded && pending.length === 0;
  const [freeText, setFreeText] = useState("");
  const [showFree, setShowFree] = useState(options.length === 0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const cardRef = useRef<HTMLLIElement>(null);

  // P8 job timing (§4.16): a conflict in front of its settler starts "settle answers", Use this
  // answer ends it; an answer sent ends "answer from a notification" if a For you open began it.
  const jobs = useRoadmapJobTimer();
  const settling = conflict && isSettler;
  useEffect(() => {
    if (settling) jobs.start("settle_answers", { itemId: item.code });
    // When the conflict reaches its settler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settling, item.code]);

  const sendText = () => {
    const text = freeText.trim();
    if (!text || !canAnswer) return;
    session.answer(question.id, { text });
    jobs.complete("answer_from_notification", { itemId: item.code });
    setFreeText("");
    setSheetOpen(false);
    setExpanded(false);
    haptic(10);
  };
  const sendOption = (optionId: string) => {
    if (!canAnswer) return;
    const label = options.find(o => o.id === optionId)?.label;
    session.answer(question.id, { optionIds: [optionId], ...(label ? { text: label } : {}) });
    jobs.complete("answer_from_notification", { itemId: item.code });
    setExpanded(false);
    haptic(10);
  };

  // 1–9 answer an option question (§4.10): while focus is in this card, or for the newest open
  // question when nothing else has focus. Off while typing in any box.
  useEffect(() => {
    if (!canAnswer || options.length === 0 || isPhone) return undefined;
    if (condensed && !expanded) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > Math.min(KEYED_OPTIONS, options.length)) return;
      const inCard = cardRef.current?.contains(document.activeElement);
      const idle = !document.activeElement || document.activeElement === document.body;
      if (!inCard && !(latest && idle)) return;
      event.preventDefault();
      sendOption(options[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAnswer, options, isPhone, condensed, expanded, latest]);

  const onUse = async (postId: string) => {
    try {
      await session.chooseAnswer(postId);
      jobs.complete("settle_answers", { itemId: item.code });
      haptic(10);
    } catch {
      toast.error(copy.chooseFailed);
    }
  };

  const freeBox = (large: boolean) => (
    <div className="flex flex-col gap-2">
      <TextArea
        id={`roadmap-q-${question.id}`}
        labelText={copy.answerLabel(question.prompt)}
        hideLabel
        rows={large ? 4 : 1}
        value={freeText}
        placeholder={copy.answerPlaceholder}
        onChange={event => {
          setFreeText(event.target.value);
          announceTyping(question.id);
        }}
        onKeyDown={event => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            sendText();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <DictationButton
          code={item.code}
          large={large}
          boxLabel={copy.answerLabel(question.prompt)}
          onText={words => typeInText(freeText, words, setFreeText, reduced)}
        />
        <Button
          kind="primary"
          size={large ? "lg" : "sm"}
          onClick={sendText}
          disabled={!freeText.trim()}
        >
          {copy.send}
        </Button>
      </div>
    </div>
  );

  const lead = answers.find(a => a.id === chosen);

  return (
    <li ref={cardRef} className="py-2" data-question={question.id}>
      <motion.div
        layout={reduced ? false : "size"}
        className="flex flex-col gap-2 border border-border-light bg-white p-3"
        transition={motionTransition("moderate", "productive", reduced)}
      >
        <span className="text-xs font-semibold text-typography-secondary">{agentName}</span>
        <p className="m-0 text-sm font-medium text-typography-primary">
          <CodeText text={question.prompt} />
        </p>

        {condensed ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 self-start rounded px-1 py-0.5 text-left text-sm hover:bg-neutral-50"
            aria-label={`${copy.changeAnswer}: ${question.prompt}`}
          >
            <DrawnCheck met size={16} />
            <span className="text-typography-primary">
              {lead
                ? postText(lead, options)
                : answers.length
                  ? postText(answers[answers.length - 1], options)
                  : legacyAnswer}
            </span>
            {answers.length > 0 && (
              <span className="text-xs text-typography-secondary">
                · {answers.map(a => a.by.name).join(", ")}
              </span>
            )}
          </button>
        ) : (
          <>
            {/* Several answers, with names and roles. */}
            {answers.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={copy.answers}>
                <AnimatePresence initial={false}>
                  {answers.map(post => (
                    <AnswerRow
                      key={post.id}
                      post={post}
                      options={options}
                      chosen={chosen === post.id}
                      dimmed={!!chosen && chosen !== post.id}
                      canUse={conflict && isSettler}
                      onUse={() => void onUse(post.id)}
                      batched={!!state?.batched}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
            <PendingAnswers pending={pending} onRetry={session.retry} />
            <AnimatePresence>
              {conflict && (
                <motion.p
                  className="m-0 text-sm text-typography-primary"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionTransition("moderate", "productive", reduced)}
                  role="status"
                >
                  {isSettler
                    ? copy.waitingForYou
                    : copy.waitingFor(state?.settler?.name ?? en.roadmapV2.idea.unknownPerson)}
                </motion.p>
              )}
            </AnimatePresence>
            {chosen && state?.settledBy && lead && (
              <p className="m-0 text-xs text-typography-secondary">
                {copy.chose(state.settledBy.name, lead.by.name)}
              </p>
            )}

            {canAnswer && !chosen && (
              <div className="flex flex-col gap-2">
                {options.length > 0 && (
                  <div className={isPhone ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>
                    {options.map((option, index) => (
                      <Button
                        key={option.id}
                        kind={mine?.optionIds?.includes(option.id) ? "primary" : "tertiary"}
                        size={isPhone ? "lg" : "sm"}
                        className={isPhone ? "w-full max-w-none" : ""}
                        onClick={() => sendOption(option.id)}
                        aria-keyshortcuts={
                          !isPhone && index < KEYED_OPTIONS ? String(index + 1) : undefined
                        }
                      >
                        {!isPhone && index < KEYED_OPTIONS
                          ? copy.optionKey(index + 1, option.label)
                          : option.label}
                      </Button>
                    ))}
                    {!showFree && (
                      <Button
                        kind="ghost"
                        size={isPhone ? "lg" : "sm"}
                        className={isPhone ? "w-full max-w-none" : ""}
                        onClick={() => (isPhone ? setSheetOpen(true) : setShowFree(true))}
                      >
                        {copy.somethingElse}
                      </Button>
                    )}
                  </div>
                )}
                {(options.length === 0 || showFree) &&
                  (isPhone ? (
                    <Button
                      kind="tertiary"
                      size="lg"
                      className="w-full max-w-none"
                      onClick={() => setSheetOpen(true)}
                    >
                      {mine ? copy.changeAnswer : copy.answerPlaceholder}
                    </Button>
                  ) : (
                    freeBox(false)
                  ))}
              </div>
            )}
          </>
        )}

        <AnimatePresence>
          {typing.length > 0 && (
            <motion.p
              className="m-0 text-xs text-typography-secondary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={motionTransition("fast", "productive", reduced)}
              aria-live="polite"
            >
              {en.roadmapV2.idea.typing(typing.join(", "))}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      {isPhone && (
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={question.prompt}
          closeLabel={en.roadmapV2.mobile.close}
        >
          {freeBox(true)}
        </BottomSheet>
      )}
    </li>
  );
};

const AnswerRow: React.FC<{
  post: RoadmapConversationPost;
  options?: { id: string; label: string }[];
  chosen: boolean;
  dimmed: boolean;
  canUse: boolean;
  onUse: () => void;
  batched: boolean;
}> = ({ post, options, chosen, dimmed, canUse, onUse, batched }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.session;
  return (
    <motion.li
      className="relative flex flex-wrap items-start gap-x-2 gap-y-1 rounded px-2 py-1"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={motionTransition("moderate", chosen ? "expressive" : "productive", reduced)}
      data-post={post.id}
      data-chosen={chosen || undefined}
    >
      {chosen && (
        <motion.span
          className="pointer-events-none absolute inset-0 rounded bg-success-50"
          initial={{ opacity: reduced ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={motionTransition("moderate", "expressive", reduced)}
          aria-hidden
        />
      )}
      <span className="relative flex items-center gap-1 text-xs font-semibold text-typography-primary">
        {chosen && <DrawnCheck met size={14} />}
        {copy.answeredBy(post.by.name, roleWord(post.by))}
      </span>
      <span className="relative min-w-0 flex-1 whitespace-pre-wrap text-sm text-typography-primary">
        {postText(post, options)}
      </span>
      {canUse && (
        <Button kind="ghost" size="sm" className="relative" onClick={onUse}>
          {copy.useThisAnswer}
        </Button>
      )}
      {!batched && !canUse && !chosen && (
        <span className="relative w-full text-xs text-typography-secondary">{copy.inNextTurn}</span>
      )}
    </motion.li>
  );
};

/** Your answers on their way: 60% while sending, "Will send when you're back online", or Retry. */
export const PendingAnswers: React.FC<{
  pending: PendingSend[];
  onRetry: (key: string) => void;
}> = ({ pending, onRetry }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.session;
  if (pending.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {pending.map(item => (
        <motion.li
          key={item.idempotencyKey}
          className="flex flex-wrap items-center gap-2 px-2 py-1 text-sm"
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
          data-pending={item.state}
        >
          <span className="text-xs font-semibold text-typography-primary">
            {copy.answeredBy(en.roadmapV2.draft.you, "")}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}</span>
          <span className="text-xs text-typography-secondary">
            {item.state === "sending" && copy.sending}
            {item.state === "offline" && copy.offline}
            {item.state === "failed" && (
              <>
                {copy.sendFailed}{" "}
                <button
                  type="button"
                  className="text-primary-700 hover:underline"
                  onClick={() => onRetry(item.idempotencyKey)}
                >
                  {copy.retry}
                </button>
              </>
            )}
          </span>
        </motion.li>
      ))}
    </ul>
  );
};
