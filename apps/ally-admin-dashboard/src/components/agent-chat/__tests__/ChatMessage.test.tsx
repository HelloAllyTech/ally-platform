import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { CourseCopilotFeedMessage } from "@types";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => undefined }));

// eslint-disable-next-line import/first
import { ChatMessage } from "../ChatMessage";

const strings = en.courseCopilot.chat;

const assistant = (overrides: Partial<CourseCopilotFeedMessage> = {}): CourseCopilotFeedMessage => ({
  id: "m1",
  role: "assistant",
  content: "",
  ...overrides,
});

const renderMessage = (
  message: CourseCopilotFeedMessage,
  props: Partial<React.ComponentProps<typeof ChatMessage>> = {},
) =>
  render(
    <ChatMessage
      message={message}
      onAnswerQuestion={vi.fn()}
      onSendSuggestion={vi.fn()}
      onRetry={vi.fn()}
      {...props}
    />,
  );

describe("agent-chat ChatMessage", () => {
  it("renders a trainer turn as a bubble", () => {
    renderMessage({ id: "u1", role: "user", content: "Make it shorter" });
    expect(screen.getByText("Make it shorter")).toBeInTheDocument();
  });

  it("renders the assistant's text through markdown", () => {
    renderMessage(assistant({ content: "Here is **the plan**" }));
    expect(screen.getByText("Here is **the plan**")).toBeInTheDocument();
  });

  it("shows a thinking state while a reply has produced nothing yet", () => {
    renderMessage(assistant({ isStreaming: true }));
    expect(screen.getByText(strings.thinking)).toBeInTheDocument();
  });

  // Stopping before any tokens arrive leaves empty content; the bubble must still show so the
  // "Stopped." note proves the Stop button did something.
  it("shows the Stopped note when a reply is interrupted before any text", () => {
    renderMessage(assistant({ interrupted: true }));
    expect(screen.getByText(strings.interrupted)).toBeInTheDocument();
  });

  it("renders tool notes above the bubble", () => {
    renderMessage(assistant({ content: "Found some.", toolNotes: ["Found 4 matching roleplays"] }));
    expect(screen.getByText("Found 4 matching roleplays")).toBeInTheDocument();
  });

  it("renders nothing for a turn whose only output was a hidden tool", () => {
    const { container } = renderMessage(assistant({ content: "  " }));
    expect(container).toBeEmptyDOMElement();
  });

  describe("errors", () => {
    it("offers Retry on a retryable error and calls onRetry", () => {
      const onRetry = vi.fn();
      renderMessage(assistant({ error: "The model was unavailable.", retryable: true }), {
        onRetry,
      });

      expect(screen.getByText("The model was unavailable.")).toBeInTheDocument();
      fireEvent.click(screen.getByText(strings.retry));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("shows the message but no Retry when a retry cannot help", () => {
      renderMessage(assistant({ error: "The copilot isn't configured.", retryable: false }));

      expect(screen.getByText("The copilot isn't configured.")).toBeInTheDocument();
      expect(screen.queryByText(strings.retry)).not.toBeInTheDocument();
    });

    it("disables Retry while another turn is streaming", () => {
      renderMessage(assistant({ error: "Unavailable.", retryable: true }), { disabled: true });
      expect(screen.getByText(strings.retry).closest("button")).toBeDisabled();
    });
  });

  describe("review findings", () => {
    const findings = [
      {
        severity: "fix" as const,
        itemId: "i1",
        note: "Quiz 2.3 has a single answer key.",
        suggestedAction: { tool: "update_item_content", input: { itemId: "i1" } },
      },
      { severity: "consider" as const, note: "Section 3 is long." },
    ];

    it("lists findings with severity, and an action chip only where there is a suggested action", () => {
      const onSendSuggestion = vi.fn();
      renderMessage(assistant({ content: "Reviewed.", reviewFindings: findings }), {
        onSendSuggestion,
      });

      expect(screen.getByText(strings.reviewHeading)).toBeInTheDocument();
      expect(screen.getByText(strings.findingFix)).toBeInTheDocument();
      expect(screen.getByText(strings.findingConsider)).toBeInTheDocument();
      // One finding has an action, the other does not.
      expect(screen.getAllByText(strings.applyFinding)).toHaveLength(1);

      fireEvent.click(screen.getByText(strings.applyFinding));
      expect(onSendSuggestion).toHaveBeenCalledWith(
        strings.applyFindingMessage("Quiz 2.3 has a single answer key.", "i1"),
      );
    });

    it("survives findings that are not an array, or have no note", () => {
      renderMessage(assistant({ content: "Reviewed.", reviewFindings: "nope" as never }));
      expect(screen.getByText("Reviewed.")).toBeInTheDocument();

      renderMessage(
        assistant({ id: "m2", content: "Again.", reviewFindings: [{ severity: "fix" } as never] }),
      );
      expect(screen.getByText("Again.")).toBeInTheDocument();
    });
  });

  describe("suggested actions", () => {
    it("renders a chip per action that sends its message", () => {
      const onSendSuggestion = vi.fn();
      renderMessage(
        assistant({
          content: "The build is done.",
          suggestedActions: [
            { label: "Open in editor", message: "Open the editor" },
            { label: "Retry the quiz", message: "Retry the failed quiz" },
          ],
        }),
        { onSendSuggestion },
      );

      fireEvent.click(screen.getByText("Retry the quiz"));
      expect(onSendSuggestion).toHaveBeenCalledWith("Retry the failed quiz");
      expect(screen.getByText("Open in editor")).toBeInTheDocument();
    });

    it("drops malformed actions", () => {
      renderMessage(
        assistant({
          content: "Done.",
          suggestedActions: [{ label: "Fine", message: "ok" }, { label: 3 } as never, null as never],
        }),
      );
      expect(screen.getByText("Fine")).toBeInTheDocument();
    });
  });

  it("renders a question as an answer card", () => {
    renderMessage(
      assistant({
        content: "Who is this for?",
        question: { id: "q1", prompt: "Who is this for?", kind: "freeText" },
      }),
    );
    expect(screen.getByText("Who is this for?")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(en.courseCopilot.question.freeTextPlaceholder)).toBeInTheDocument();
  });
});
