import React, { useMemo, useState } from "react";

import { motion } from "framer-motion";

import { CarbonToggle, SkeletonText, Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { ChatMessage } from "@components/builder";
import { en } from "@constants";
import type {
  BuilderChatMessage,
  BuilderServerMessage,
  RoadmapItemDetail,
  RoadmapPersonRef,
} from "@types";

import { CodeText } from "./CodeChip";
import { mapServerMessagesToFeed } from "../../../hooks/useBuilderStream";
import { motionTransition, useReducedMotionPreference } from "../../../motion";
import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { CommentBox, CommentItem } from "../session/CommentBox";
import { QuestionCard } from "../session/QuestionCard";
import { commentAnchors, isPlanPost, planStartFeedIndex } from "../session/sessionFeed";
import { useSessionAnswers } from "../session/useSessionAnswers";
import { personLabel, shortDate, stageWord } from "../utils/copy";

const noop = () => undefined;

/** The agent's name follows the phase (§4.5): Idea agent → Plan agent → Builder. */
export const agentNameFor = (stage: RoadmapItemDetail["shownStage"]): string => {
  const names = en.roadmapV2.idea.agentNames;
  if (stage === "building" || stage === "shipped") return names.build;
  if (stage === "planning") return names.plan;
  return names.idea;
};

/** One line for an agent turn while Show agent work is off. */
export const summariseAgentTurn = (message: BuilderChatMessage): string => {
  const text = (message.content ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  const notes = Array.isArray(message.toolNotes) ? message.toolNotes : [];
  return en.roadmapV2.idea.agentStepSummary(Math.max(1, notes.length));
};

/** A dated phase marker; the divider draws outward from its label (§4.18). */
const PhaseMarker: React.FC<{ label: string }> = ({ label }) => {
  const reduced = useReducedMotionPreference();
  const line = (side: "left" | "right") => (
    <motion.span
      className={`h-px flex-1 bg-border-light ${side === "left" ? "origin-right" : "origin-left"}`}
      initial={reduced ? { opacity: 0 } : { scaleX: 0 }}
      animate={reduced ? { opacity: 1 } : { scaleX: 1 }}
      transition={motionTransition("slow", "productive", reduced)}
      aria-hidden
    />
  );
  return (
    <li
      className="flex items-center gap-3 py-2 text-xs text-typography-secondary"
      role="separator"
      aria-label={label}
    >
      {line("left")}
      <span className="shrink-0">{label}</span>
      {line("right")}
    </li>
  );
};

interface ConversationProps {
  item: RoadmapItemDetail;
  /** The session's persisted transcript (GET /builder/sessions/:id). */
  messages?: BuilderServerMessage[];
  isLoading: boolean;
  isError: boolean;
  showAgentWork: boolean;
  onShowAgentWorkChange: (on: boolean) => void;
}

/**
 * The conversation (§4.5): the one session from first word to release, with phase markers, each
 * human turn's name and role, and one-line agent summaries until Show agent work is on (each › also
 * expands one step in place). Built from Builder's own transcript pieces: the server rows go
 * through `mapServerMessagesToFeed` and agent turns render with `ChatMessage`.
 *
 * P3b (§4.5a): each agent question is a card with its own answer box, answers from several people
 * with "Use this answer" for the settler; comments to people sit in the feed by time, and the
 * comment box with @mentions sits under it (on a phone it's the 💬 sheet instead). Answers and
 * comments arrive in the transcript as `metadata.planPost` rows; they render as those cards, never
 * as the lead's own messages.
 */
export const Conversation: React.FC<ConversationProps> = ({
  item,
  messages,
  isLoading,
  isError,
  showAgentWork,
  onShowAgentWorkChange,
}) => {
  const copy = en.roadmapV2.idea;
  const reduced = useReducedMotionPreference();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const serverMessages = useMemo(
    () => (Array.isArray(messages) ? messages : []).filter(m => !isPlanPost(m)),
    [messages],
  );
  const session = useSessionAnswers(item);
  const isPhone = useRoadmapBreakpoint() === "phone";
  const feed = useMemo(() => mapServerMessagesToFeed(serverMessages), [serverMessages]);
  // Who wrote each human turn (builder_messages.createdBy) and when, by server row id.
  const meta = useMemo(() => {
    const map = new Map<string, { createdBy?: number; createdAt?: string }>();
    serverMessages.forEach(m => {
      const createdBy = (m as unknown as { createdBy?: unknown }).createdBy;
      map.set(m.id, {
        createdBy: typeof createdBy === "number" ? createdBy : undefined,
        createdAt: m.createdAt,
      });
    });
    return map;
  }, [serverMessages]);

  const people: RoadmapPersonRef[] = Array.isArray(item.people) ? item.people : [];
  const personFor = (id?: number) => (id == null ? undefined : people.find(p => p.id === id));
  const agentName = agentNameFor(item.shownStage);

  // Phase markers: Submitted at the top, then the current stage where its first turn lands.
  const stageSince = item.stageSince ? new Date(item.stageSince).getTime() : NaN;
  const markerIndex = useMemo(() => {
    if (Number.isNaN(stageSince) || item.shownStage === "submitted") return -1;
    return feed.findIndex(message => {
      const at = meta.get(message.id)?.createdAt;
      return at ? new Date(at).getTime() >= stageSince : false;
    });
  }, [feed, meta, stageSince, item.shownStage]);
  const currentMarker = copy.phaseMarker(stageWord(item.shownStage), shortDate(item.stageSince));
  const submittedMarker = copy.phases.submitted(item.author?.name ?? copy.unknownPerson);

  const anchors = useMemo(
    () => commentAnchors(feed, meta, session.comments),
    [feed, meta, session.comments],
  );
  const planStart = useMemo(() => planStartFeedIndex(feed, serverMessages), [feed, serverMessages]);
  const latestQuestionId = useMemo(() => {
    for (let i = feed.length - 1; i >= 0; i -= 1) if (feed[i].question) return feed[i].question!.id;
    return undefined;
  }, [feed]);

  const toggleStep = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderMessage = (message: BuilderChatMessage, index: number) => {
    if (message.role === "user") {
      const person = personFor(meta.get(message.id)?.createdBy);
      return (
        <li key={message.id} className="flex flex-col gap-0.5 py-2">
          <span className="text-xs font-semibold text-typography-primary">
            {person ? personLabel(person) : copy.unknownPerson}
          </span>
          <p className="m-0 whitespace-pre-wrap text-sm text-typography-primary">
            <CodeText text={message.content ?? ""} />
          </p>
        </li>
      );
    }
    if (message.question) {
      return (
        <QuestionCard
          key={message.id}
          question={message.question}
          legacyAnswer={message.answeredWith}
          item={item}
          session={session}
          agentName={agentName}
          latest={message.question.id === latestQuestionId}
        />
      );
    }
    const open = showAgentWork || expanded.has(message.id);
    return (
      <li key={message.id} className="py-1.5">
        {open ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-typography-secondary">{agentName}</span>
            <ChatMessage message={message} index={index} onAnswer={noop} disabled />
            {!showAgentWork && (
              <button
                type="button"
                onClick={() => toggleStep(message.id)}
                aria-expanded="true"
                className="self-start text-xs text-primary-700 hover:underline"
              >
                {copy.collapseStep}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => toggleStep(message.id)}
            aria-expanded="false"
            aria-label={`${summariseAgentTurn(message)}. ${copy.expandStep}`}
            className="flex w-full min-w-0 items-baseline gap-2 rounded px-1 py-1 text-left text-sm hover:bg-neutral-50"
          >
            <span className="shrink-0 text-xs font-semibold text-typography-secondary">
              {agentName}
            </span>
            <span className="min-w-0 flex-1 truncate text-typography-primary">
              {summariseAgentTurn(message)}
            </span>
            <motion.span
              aria-hidden
              className="shrink-0 text-typography-secondary"
              animate={{ rotate: 0 }}
              transition={motionTransition("moderate", "productive", reduced)}
            >
              ›
            </motion.span>
          </button>
        )}
      </li>
    );
  };

  return (
    <section aria-label={copy.conversation} className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <h2 className="text-sm font-semibold text-typography-primary">{copy.conversation}</h2>
        <div className="flex items-center gap-1">
          <CarbonToggle
            id={`roadmap-agent-work-${item.code}`}
            size="sm"
            labelText={copy.showAgentWork}
            hideLabel={false}
            labelA=""
            labelB=""
            toggled={showAgentWork}
            onToggle={(on: boolean) => onShowAgentWorkChange(on)}
            className="[&_.cds--toggle\_\_label-text]:text-xs"
          />
          <Tooltip label={copy.showAgentWorkHelp} align="bottom">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center"
              aria-label={copy.showAgentWorkHelp}
            >
              <TooltipIcon />
            </button>
          </Tooltip>
        </div>
      </div>

      <ol className="m-0 list-none p-0" aria-live="polite">
        <PhaseMarker
          label={copy.phaseMarker(
            submittedMarker,
            shortDate(
              item.stageSince && item.shownStage === "submitted" ? item.stageSince : undefined,
            ),
          )}
        />
        {isLoading && (
          <li className="py-2" aria-busy="true">
            <SkeletonText paragraph lineCount={4} />
          </li>
        )}
        {isError && (
          <li className="py-2 text-sm text-typography-secondary">{copy.conversationLoadError}</li>
        )}
        {!isLoading && !isError && !item.sessionId && (
          <li className="py-2 text-sm text-typography-secondary">{copy.noSession}</li>
        )}
        {!isLoading && !isError && item.sessionId && feed.length === 0 && (
          <li className="py-2 text-sm text-typography-secondary">{copy.noConversation}</li>
        )}
        {feed.map((message, index) => (
          <React.Fragment key={message.id}>
            {index === planStart && <PhaseMarker label={en.roadmapV2.session.phasePlan} />}
            {index === markerIndex && <PhaseMarker label={currentMarker} />}
            {(anchors.get(message.id) ?? []).map(post => (
              <CommentItem key={post.id} post={post} />
            ))}
            {renderMessage(message, index)}
          </React.Fragment>
        ))}
        {(anchors.get(null) ?? []).map(post => (
          <CommentItem key={post.id} post={post} />
        ))}
        {markerIndex === -1 && item.shownStage !== "submitted" && !isLoading && (
          <PhaseMarker label={currentMarker} />
        )}
      </ol>
      {!isPhone && (
        <div className="pt-3">
          <CommentBox item={item} session={session} />
        </div>
      )}
    </section>
  );
};
