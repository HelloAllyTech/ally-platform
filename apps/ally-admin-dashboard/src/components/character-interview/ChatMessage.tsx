import React from "react";

import { en } from "@constants";
import { CharacterInterviewChatMessage } from "@types";

import { CharacterInterviewAnswerPayload, QuestionCard } from "./QuestionCard";
import { ChatMessage as AgentChatMessage } from "../agent-chat/ChatMessage";

interface ChatMessageProps {
  message: CharacterInterviewChatMessage;
  onAnswerQuestion: (payload: CharacterInterviewAnswerPayload) => void | Promise<boolean | void>;
  disabled?: boolean;
}

/**
 * One interview feed row: the shared agent-chat row in the interview's wording. A question goes
 * through the interview's own card instead, which adds the voice picker.
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onAnswerQuestion,
  disabled = false,
}) =>
  message.question ? (
    <QuestionCard
      question={message.question}
      answeredWith={message.answeredWith}
      answeredAnswer={message.answeredAnswer}
      onAnswer={onAnswerQuestion}
      disabled={disabled}
    />
  ) : (
    <AgentChatMessage
      message={message}
      onAnswerQuestion={onAnswerQuestion}
      disabled={disabled}
      strings={en.characterInterview.chat}
    />
  );
