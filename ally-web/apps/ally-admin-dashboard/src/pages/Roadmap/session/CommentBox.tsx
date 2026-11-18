import React, { useMemo, useRef, useState } from "react";

import { motion } from "framer-motion";
import { toast } from "sonner";

import { Button, TextArea, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import type { RoadmapItemDetail, RoadmapPersonRef } from "@types";

import { useRoadmapPresence, useTypingIn } from "./presenceContext";
import { PendingAnswers } from "./QuestionCard";
import { SessionAnswers } from "./useSessionAnswers";
import { useOpenRoadmapConversationMutation } from "../../../api/roadmapV2Flow";
import { fadeUpVariants, motionTransition, useReducedMotionPreference } from "../../../motion";
import { CodeText } from "../components/CodeChip";
import { DictationButton } from "../components/DictationButton";
import { typeInText } from "../hooks/useDictation";
import { personLabel } from "../utils/copy";

import type { RoadmapConversationPost } from "../../../types/roadmapV2Flow";

/** Opens the conversation on an older idea that has none (it was filed before ideas had one). */
export const OpenConversationButton: React.FC<{ code: string }> = ({ code }) => {
  const copy = en.roadmapV2.session;
  const [open, { isLoading }] = useOpenRoadmapConversationMutation();
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        kind="tertiary"
        size="sm"
        disabled={isLoading}
        onClick={async () => {
          try {
            await open(code).unwrap();
          } catch {
            toast.error(copy.openConversationFailed);
          }
        }}
      >
        {copy.openConversation}
      </Button>
      <Tooltip label={copy.openConversationHelp} align="top">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center"
          aria-label={copy.openConversationHelp}
        >
          <TooltipIcon />
        </button>
      </Tooltip>
    </span>
  );
};

/** The @word being typed at the caret, if any: "@pri" → { query: "pri", start }. */
export const mentionAt = (text: string, caret: number): { query: string; start: number } | null => {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{M}.'-]{0,30})$/u.exec(before);
  if (!match) return null;
  return { query: match[2], start: caret - match[2].length - 1 };
};

/** The people a comment mentions: every "@Name" still in the text. */
export const mentionedIds = (text: string, people: RoadmapPersonRef[]): number[] =>
  people.filter(p => text.includes(`@${p.name}`)).map(p => p.id);

/** One comment to people, in the conversation (§4.5a). */
export const CommentItem: React.FC<{ post: RoadmapConversationPost; index?: number }> = ({
  post,
}) => {
  const reduced = useReducedMotionPreference();
  return (
    <motion.li
      className="flex flex-col gap-0.5 border-l-2 border-border-light py-2 pl-3"
      {...fadeUpVariants(reduced, 8)}
      transition={motionTransition("moderate", "productive", reduced)}
      data-comment={post.id}
    >
      <span className="text-xs font-semibold text-typography-primary">{personLabel(post.by)}</span>
      <p className="m-0 whitespace-pre-wrap text-sm text-typography-primary">
        <CodeText text={post.text} />
      </p>
    </motion.li>
  );
};

interface CommentBoxProps {
  item: RoadmapItemDetail;
  session: SessionAnswers;
  /** Phone sheet: bigger targets and the 56 px mic. */
  large?: boolean;
  onSent?: () => void;
  autoFocus?: boolean;
}

/**
 * The bottom box is for comments to people, with @mentions, which notify (§4.5a). The agent reads
 * comments as context and never treats them as answers — the tooltip says so, because the box sits
 * where a chat's reply box usually is.
 */
export const CommentBox: React.FC<CommentBoxProps> = ({
  item,
  session,
  large,
  onSent,
  autoFocus,
}) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.session;
  const { announceTyping } = useRoadmapPresence();
  const typing = useTypingIn(undefined);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const people = useMemo(() => (Array.isArray(item.people) ? item.people : []), [item.people]);
  const mention = mentionAt(text, caret);
  const matches = useMemo(
    () =>
      mention
        ? people.filter(p => p.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
        : [],
    [mention, people],
  );
  // An older idea with no conversation yet: offer to open one, so it can take comments too.
  if (item.can?.comment && !item.sessionId && item.shownStage !== "draft") {
    return <OpenConversationButton code={item.code} />;
  }
  const canComment = !!item.can?.comment && session.enabled;
  if (!canComment) return null;

  const pick = (person: RoadmapPersonRef) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${person.name} ${text.slice(caret)}`;
    const nextCaret = mention.start + person.name.length + 2;
    setText(next);
    setCaret(nextCaret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    session.comment(body, mentionedIds(body, people));
    setText("");
    setCaret(0);
    onSent?.();
  };

  const listId = `roadmap-mentions-${item.code}`;
  const pending = session.pending.filter(p => p.kind === "comment");

  return (
    <div className="flex flex-col gap-1">
      <PendingAnswers pending={pending} onRetry={session.retry} />
      <div className="relative flex flex-col gap-2">
        <TextArea
          id={`roadmap-comment-${item.code}`}
          labelText={copy.commentLabel}
          hideLabel
          ref={ref}
          rows={large ? 4 : 1}
          value={text}
          autoFocus={autoFocus}
          placeholder={copy.commentPlaceholder}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={event => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setActive(0);
            announceTyping(undefined);
          }}
          onSelect={event => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={event => {
            if (matches.length > 0) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive(
                  a => (a + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                pick(matches[active] ?? matches[0]);
                return;
              }
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <DictationButton
            code={item.code}
            large={large}
            boxLabel={copy.commentLabel}
            onText={words => typeInText(text, words, setText, reduced)}
          />
          <Button kind="primary" size={large ? "lg" : "sm"} onClick={send} disabled={!text.trim()}>
            {copy.commentSend}
          </Button>
        </div>
        {matches.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={copy.mentionList}
            className="absolute bottom-full left-2 z-10 m-0 mb-1 w-64 list-none rounded border border-border-light bg-white p-1 shadow"
          >
            {matches.map((person, index) => (
              <li
                key={person.id}
                role="option"
                aria-selected={index === active}
                onMouseDown={event => {
                  event.preventDefault();
                  pick(person);
                }}
                className={`cursor-pointer rounded px-2 py-2 text-sm ${index === active ? "bg-primary-50" : ""}`}
              >
                {personLabel(person)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1">
        {typing.length > 0 ? (
          <span className="text-xs text-typography-secondary" aria-live="polite">
            {en.roadmapV2.idea.typing(typing.join(", "))}
          </span>
        ) : (
          <span className="text-xs text-typography-secondary">{copy.commentLabel}</span>
        )}
        <Tooltip label={copy.commentHelp} align="top">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center"
            aria-label={copy.commentHelp}
          >
            <TooltipIcon />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};
