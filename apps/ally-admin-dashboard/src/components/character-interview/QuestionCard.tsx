import React, { useMemo } from "react";

import { en } from "@constants";

import { useIsVoiceQuestion, VoiceQuestionOptions } from "./VoiceQuestionOptions";
import {
  AgentAnswerPayload,
  QuestionCard as AgentQuestionCard,
  QuestionCardProps as AgentQuestionCardProps,
} from "../agent-chat/QuestionCard";

export type CharacterInterviewAnswerPayload = AgentAnswerPayload;

type QuestionCardProps = Pick<
  AgentQuestionCardProps,
  "question" | "answeredWith" | "answeredAnswer" | "onAnswer" | "disabled"
>;

/**
 * The interview's question card: the shared agent-chat card in the interview's wording, with a
 * voice question drawn as playable rows.
 *
 * A voice question is recognised by its options resolving to catalog voices, not by
 * `question.kind`: the interviewer prompt says to ask with `dropdown`, but with a shortlist of four
 * the live agent asks as `singleSelect` — so gating on the kind left the real voice question with
 * no play buttons at all. The agent picks the widget; what matters is that these are voices.
 */
export const QuestionCard: React.FC<QuestionCardProps> = props => {
  const options = useMemo(
    () => (Array.isArray(props.question.options) ? props.question.options : []),
    [props.question.options],
  );
  const isVoiceQuestion = useIsVoiceQuestion(options);

  return (
    <AgentQuestionCard
      {...props}
      strings={en.characterInterview.question}
      renderOptions={isVoiceQuestion ? picker => <VoiceQuestionOptions {...picker} /> : undefined}
    />
  );
};
