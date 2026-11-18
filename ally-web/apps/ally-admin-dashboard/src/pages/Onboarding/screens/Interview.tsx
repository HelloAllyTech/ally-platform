import React, { useState } from "react";

import { AssistantLine, Button, PrimaryButton, Question } from "@components/v2";

import { COPY } from "../copy";

import type { BotDraftView } from "../types";

/**
 * "Interview me": the builder's latest question as the heading, a box for the owner's answer, and
 * "That's everything" to go on to "What we learned" (where the facts it picked up wait to be
 * checked). The answers themselves are ordinary builder messages.
 */
export const InterviewScreen: React.FC<{
  view: BotDraftView;
  busy: boolean;
  working: string | null;
  streaming: string;
  onSend: (text: string) => void;
  onDone: () => void;
}> = ({ view, busy, working, streaming, onSend, onDone }) => {
  const [answer, setAnswer] = useState("");
  const question = [...view.transcript].reverse().find(entry => entry.role === "builder")?.text;

  return (
    <Question title={question ?? COPY.start.interviewTitle}>
      {busy && (
        <AssistantLine working streaming={Boolean(streaming)}>
          {streaming || working || ""}
        </AssistantLine>
      )}
      <form
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={event => {
          event.preventDefault();
          if (!answer.trim() || busy) return;
          onSend(answer.trim());
          setAnswer("");
        }}
      >
        <textarea
          aria-label={COPY.start.interviewAnswer}
          className="ally-input"
          rows={5}
          value={answer}
          onChange={event => setAnswer(event.target.value)}
          placeholder={COPY.start.interviewAnswerPlaceholder}
          autoFocus
        />
        <PrimaryButton type="submit" disabled={!answer.trim() || busy}>
          {COPY.start.interviewSend}
        </PrimaryButton>
      </form>
      <Button variant="ghost" disabled={busy} onClick={onDone}>
        {COPY.start.interviewDone}
      </Button>
    </Question>
  );
};
