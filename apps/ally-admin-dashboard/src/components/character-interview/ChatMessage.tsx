import React from "react";

import { en } from "@constants";
import { CharacterInterviewChatMessage } from "@types";

import { CharacterInterviewAnswerPayload, QuestionCard } from "./QuestionCard";
import { AgentReceipt } from "../agent-chat/AgentReceipt";
import { ChatMessage as AgentChatMessage } from "../agent-chat/ChatMessage";

interface ChatMessageProps {
  message: CharacterInterviewChatMessage;
  onAnswerQuestion: (payload: CharacterInterviewAnswerPayload) => void | Promise<boolean | void>;
  disabled?: boolean;
}

/**
 * One interview feed row: the shared agent-chat row in the interview's wording. A question goes
 * through the interview's own card instead, which adds the voice picker. An assistant row that
 * carries a turn receipt draws it under the bubble.
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onAnswerQuestion,
  disabled = false,
}) => {
  if (message.question) {
    return (
      <QuestionCard
        question={message.question}
        answeredWith={message.answeredWith}
        answeredAnswer={message.answeredAnswer}
        onAnswer={onAnswerQuestion}
        disabled={disabled}
      />
    );
  }
  const row = (
    <AgentChatMessage
      message={message}
      onAnswerQuestion={onAnswerQuestion}
      disabled={disabled}
      strings={en.characterInterview.chat}
    />
  );
  if (message.role !== "assistant" || !message.receipt) return row;
  return (
    <div className="flex flex-col gap-1">
      {row}
      <AgentReceipt receipt={message.receipt} strings={en.characterInterview.receipt} />
    </div>
  );
};
