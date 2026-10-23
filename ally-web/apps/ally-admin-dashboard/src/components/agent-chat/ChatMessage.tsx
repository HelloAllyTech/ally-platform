import React from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button, InlineLoading, InlineNotification, Tile } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { AgentChatMessage, CourseCopilotSuggestedAction, CourseReviewFinding } from "@types";

import { AgentAnswerPayload, QuestionCard } from "./QuestionCard";
import { sharedMarkdownComponents } from "../markdown/markdownComponents";

export type AgentChatStrings = typeof en.agentChat.chat;

export interface ChatMessageProps {
  message: AgentChatMessage;
  onAnswerQuestion: (payload: AgentAnswerPayload) => void | Promise<boolean | void>;
  /** A chip was clicked: send this text as the admin's next turn. */
  onSendSuggestion?: (text: string) => void;
  /** Re-send the last user turn (the error's Retry chip). */
  onRetry?: () => void;
  disabled?: boolean;
  /** The feature's own wording where it differs from the shared `en.agentChat.chat`. */
  strings?: Partial<AgentChatStrings>;
  /**
   * Turns a tool note into what the admin reads, for a feed that records raw tool names (Builder)
   * rather than the sentence to show.
   */
  formatToolNote?: (note: string) => string;
}

/**
 * One row of an agent chat feed — shared by Builder, Course Copilot and the character interview.
 *
 * Tool activity renders as small notes above the bubble rather than as transcript lines: what the
 * agent just did is worth seeing at a glance, but it is not what the admin is here to read, and
 * interleaving it with the prose buries the question.
 *
 * Everything the agent authored is normalised with `Array.isArray`/`typeof` before it is mapped —
 * a string where an array was expected once crashed Builder's PRD panel, and a chat row is not
 * worth taking the feed down for.
 */
export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onAnswerQuestion,
  onSendSuggestion,
  onRetry,
  disabled = false,
  strings: stringOverrides,
  formatToolNote,
}) => {
  const strings: AgentChatStrings = { ...en.agentChat.chat, ...stringOverrides };

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

  const content = typeof message.content === "string" ? message.content : "";

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary-600 px-3 py-2 text-sm text-white">
          {content}
        </div>
      </div>
    );
  }

  const toolNotes = (Array.isArray(message.toolNotes) ? message.toolNotes : [])
    .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    .map(note => (formatToolNote ? formatToolNote(note) : note));
  const findings = (Array.isArray(message.reviewFindings) ? message.reviewFindings : []).filter(
    (finding): finding is CourseReviewFinding =>
      Boolean(finding) && typeof finding.note === "string" && finding.note.trim().length > 0,
  );
  const actions = (Array.isArray(message.suggestedActions) ? message.suggestedActions : []).filter(
    (action): action is CourseCopilotSuggestedAction =>
      Boolean(action) && typeof action.label === "string" && typeof action.message === "string",
  );

  const hasBody = content.trim().length > 0;
  const showBubble = hasBody || message.isStreaming || message.interrupted;
  const canRetry = Boolean(message.retryable && onRetry);

  // Nothing to draw: a turn whose only output was a question card (drawn as its own row) or an
  // internal tool the contract hides. Rendering an empty wrapper would leave a stray flex gap.
  if (!showBubble && !toolNotes.length && !findings.length && !actions.length && !message.error) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {toolNotes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {toolNotes.map((note, noteIndex) => (
            // A span, not Carbon's <Tag>: Tag renders a <button>, and a note that looks
            // clickable and does nothing is a worse affordance than plain text.
            <span
              key={`${note}-${noteIndex}`}
              className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-typography-600"
            >
              {note}
            </span>
          ))}
        </div>
      )}

      {showBubble && (
        <Tile className="w-full max-w-[92%]">
          {hasBody ? (
            <div className="prose prose-sm max-w-none break-words text-sm text-typography-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={sharedMarkdownComponents}>
                {content}
              </ReactMarkdown>
            </div>
          ) : message.isStreaming ? (
            <InlineLoading description={strings.thinking} />
          ) : null}
          {message.interrupted && (
            <p className="mt-2 text-xs italic text-typography-500">{strings.interrupted}</p>
          )}
        </Tile>
      )}

      {findings.length > 0 && (
        <Tile className="w-full max-w-[92%]">
          <p className="text-xs font-medium tracking-wide text-typography-500">
            {strings.reviewHeading}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {findings.map((finding, index) => (
              <li
                key={`${finding.itemId ?? "course"}-${index}`}
                className="flex flex-wrap items-start justify-between gap-2"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {/* Plain span for the severity, not a Tag (a <button>) — it is a label. */}
                  <span
                    className={[
                      "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      finding.severity === "fix"
                        ? "bg-destructive-50 text-destructive-600"
                        : "bg-neutral-100 text-typography-600",
                    ].join(" ")}
                  >
                    {finding.severity === "fix" ? strings.findingFix : strings.findingConsider}
                  </span>
                  <p className="min-w-0 break-words text-sm text-typography-800">{finding.note}</p>
                </div>
                {/* Only a finding the reviewer could express as a tool call gets an action: the
                    chip sends it as a chat turn, so the same edit path (and structural-lock
                    handling) runs as for any other request. */}
                {finding.suggestedAction && onSendSuggestion && (
                  <Button
                    kind="tertiary"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      onSendSuggestion(strings.applyFindingMessage(finding.note, finding.itemId))
                    }
                  >
                    {strings.applyFinding}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {message.error && (
        <div className="flex w-full max-w-[92%] flex-col items-start gap-1">
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={message.error}
            className="w-full"
          />
          {canRetry && (
            <Button kind="tertiary" size="sm" disabled={disabled} onClick={onRetry}>
              {strings.retry}
            </Button>
          )}
        </div>
      )}

      {actions.length > 0 && onSendSuggestion && (
        <div
          role="group"
          className="flex max-w-[92%] flex-wrap gap-2"
          aria-label={strings.suggestedActionsLabel}
        >
          {actions.map((action, index) => (
            <Button
              key={`${action.label}-${index}`}
              kind="tertiary"
              size="sm"
              disabled={disabled}
              onClick={() => onSendSuggestion(action.message)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
