import React from "react";

import { BuilderChatMessage } from "@types";

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
};

const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

interface ChatMessageProps {
  message: BuilderChatMessage;
  index: number;
  onAnswer: (payload: AgentAnswerPayload) => void;
  disabled?: boolean;
}

/**
 * One row of Builder's interview feed: the shared agent-chat row, with Builder's tool labels (its
 * feed records raw tool names) and its entrance motion — rows fade in, staggered by position, so a
 * burst of events reads as a sequence.
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({ message, index, onAnswer, disabled }) => {
  const entrance = prefersReducedMotion()
    ? undefined
    : {
        animation: "builderFadeIn 240ms both",
        animationDelay: `${staggerDelayMs(index)}ms`,
        transition: builderTransition(["opacity"]),
      };

  return (
    <div style={entrance}>
      <AgentChatMessage
        message={message}
        onAnswerQuestion={onAnswer}
        disabled={disabled}
        formatToolNote={toolLabel}
      />
    </div>
  );
};
