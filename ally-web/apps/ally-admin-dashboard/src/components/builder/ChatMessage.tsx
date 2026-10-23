import React from "react";

import { BuilderBriefResponse, BuilderChatMessage } from "@types";

import { SituationBriefCard } from "./SituationBriefCard";
import { TurnReceipt } from "./TurnReceipt";
import {
  builderTransition,
  prefersReducedMotion,
  staggerDelayMs,
} from "../../pages/Builder/builderMotion";
import { ChatMessage as AgentChatMessage } from "../agent-chat/ChatMessage";
import { AgentAnswerPayload } from "../agent-chat/QuestionCard";

/** Human-readable labels for the interview agent's tools — the raw names leak plumbing. */
const TOOL_LABELS: Record<string, string> = {
  ask_admin: "Asking you",
  update_prd: "Writing the PRD",
  github_search_code: "Searching the codebase",
  github_read_file: "Reading a file",
  github_repo_tree: "Looking through a repo",
  stacks_search: "Checking product guidance",
  stacks_get: "Reading product guidance",
  list_repo_commands: "Checking repo commands",
  // Lookups.
  capability_lookup: "Checking what already exists",
  ai_tasks_lookup: "Checking which AI tasks exist",
  docs_search: "Searching the docs",
  wiki_search: "Searching the wiki",
  wiki_read: "Reading a wiki page",
  analytics_ask: "Asking analytics",
  prod_errors: "Checking production errors",
  bug_findings_search: "Searching bug findings",
  ux_signals_lookup: "Checking UX signals",
  // PRD edits — one tool per kind of change, so the chip says what is being written.
  set_section: "Writing a PRD section",
  upsert_requirement: "Writing a requirement",
  remove_requirement: "Removing a requirement",
  set_repo_plan: "Planning a repo",
  remove_repo_plan: "Removing a repo plan",
  upsert_assumption: "Recording an assumption",
  set_open_questions: "Updating open questions",
  // Review.
  prd_review: "Reviewing the PRD",
  prd_recheck: "Rechecking the PRD",
  dismiss_review_finding: "Dismissing a review finding",
};

const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

interface ChatMessageProps {
  message: BuilderChatMessage;
  index: number;
  onAnswer: (payload: AgentAnswerPayload) => void;
  /** The situation brief's answer, and the one line the feed shows for it. */
  onAnswerBrief?: (response: BuilderBriefResponse, summary: string) => void;
  disabled?: boolean;
}

/**
 * One row of Builder's interview feed: the shared agent-chat row, with Builder's tool labels (its
 * feed records raw tool names) and its entrance motion — rows fade in, staggered by position, so a
 * burst of events reads as a sequence.
 *
 * An assistant row that carries a turn receipt draws it under the bubble. That lives here rather
 * than in the shared row because only Builder has receipts; a question card and the admin's own
 * messages never show one.
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  index,
  onAnswer,
  onAnswerBrief,
  disabled,
}) => {
  const entrance = prefersReducedMotion()
    ? undefined
    : {
        animation: "builderFadeIn 240ms both",
        animationDelay: `${staggerDelayMs(index)}ms`,
        transition: builderTransition(["opacity"]),
      };

  if (message.brief) {
    return (
      <div style={entrance}>
        <SituationBriefCard
          brief={message.brief}
          answered={message.answeredBrief}
          onSubmit={(response, summary) => onAnswerBrief?.(response, summary)}
          disabled={disabled || !onAnswerBrief}
        />
      </div>
    );
  }

  const showReceipt = message.role === "assistant" && !message.question && Boolean(message.receipt);

  return (
    <div style={entrance} className={showReceipt ? "flex flex-col gap-1" : undefined}>
      <AgentChatMessage
        message={message}
        onAnswerQuestion={onAnswer}
        disabled={disabled}
        formatToolNote={toolLabel}
      />
      {showReceipt && <TurnReceipt receipt={message.receipt} />}
    </div>
  );
};
