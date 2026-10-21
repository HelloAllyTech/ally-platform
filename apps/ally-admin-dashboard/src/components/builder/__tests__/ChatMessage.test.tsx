import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderChatMessage, BuilderTurnReceipt } from "@types";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => undefined }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Checkbox: () => <input type="checkbox" />,
  FilterableMultiSelect: () => <div />,
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
  TextArea: ({ labelText }: any) => <textarea aria-label={labelText} />,
  TextInput: ({ labelText }: any) => <input aria-label={labelText} />,
  Tile: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// eslint-disable-next-line import/first
import { ChatMessage } from "../ChatMessage";

const baseMessage: BuilderChatMessage = {
  id: "msg-1",
  role: "assistant",
  content: "",
};

/**
 * Stopping the agent before any tokens arrive leaves content empty and
 * isStreaming false. The bubble still has to show up so the "Stopped." note
 * is visible — otherwise the Stop button looks like it did nothing.
 */
describe("ChatMessage", () => {
  it("shows the Stopped note when a reply is interrupted before any text streams back", () => {
    render(
      <ChatMessage
        message={{ ...baseMessage, isStreaming: false, interrupted: true }}
        index={0}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText("Stopped.")).toBeInTheDocument();
  });

  describe("the turn receipt", () => {
    const receipt: BuilderTurnReceipt = {
      read: ["ally-be/src/builder/x.ts"],
      searched: [],
      changed: ["Requirements: added R4"],
      prdVersion: { from: 2, to: 3 },
      failed: ["Read ally-be/src/gone.ts — Not Found"],
      warnings: [],
    };

    it("draws under the reply it belongs to", () => {
      render(
        <ChatMessage
          message={{ ...baseMessage, content: "Added R4.", receipt }}
          index={0}
          onAnswer={vi.fn()}
        />,
      );

      expect(screen.getByText("Added R4.")).toBeInTheDocument();
      expect(screen.getByText("Read 1 · Changed 1 section · PRD v2 → v3")).toBeInTheDocument();
      expect(screen.getByText("Read ally-be/src/gone.ts — Not Found")).toBeVisible();
    });

    it("draws for a turn that had no reply text, so it is not silent about what it did", () => {
      render(
        <ChatMessage
          message={{ ...baseMessage, content: "", receipt }}
          index={0}
          onAnswer={vi.fn()}
        />,
      );

      expect(screen.getByText("Read 1 · Changed 1 section · PRD v2 → v3")).toBeInTheDocument();
    });

    it("stays off a question card, which is drawn as its own row", () => {
      render(
        <ChatMessage
          message={{
            ...baseMessage,
            receipt,
            question: { id: "q1", prompt: "Which repo?", kind: "freeText" },
          }}
          index={0}
          onAnswer={vi.fn()}
        />,
      );

      expect(screen.getByText("Which repo?")).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "What this turn did" })).not.toBeInTheDocument();
    });

    it("stays off the admin's own messages", () => {
      render(
        <ChatMessage
          message={{ ...baseMessage, role: "user", content: "Add a banner", receipt }}
          index={0}
          onAnswer={vi.fn()}
        />,
      );

      expect(screen.getByText("Add a banner")).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "What this turn did" })).not.toBeInTheDocument();
    });
  });

  describe("tool chips", () => {
    it.each([
      ["upsert_requirement", "Writing a requirement"],
      ["set_repo_plan", "Planning a repo"],
      ["capability_lookup", "Checking what already exists"],
      ["docs_search", "Searching the docs"],
      ["prd_review", "Reviewing the PRD"],
    ])("labels %s as %s", (tool, label) => {
      render(
        <ChatMessage
          message={{ ...baseMessage, content: "Working.", toolNotes: [tool] }}
          index={0}
          onAnswer={vi.fn()}
        />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it("shows a tool with no label by its own name rather than hiding it", () => {
      render(
        <ChatMessage
          message={{ ...baseMessage, content: "Working.", toolNotes: ["brand_new_tool"] }}
          index={0}
          onAnswer={vi.fn()}
        />,
      );

      expect(screen.getByText("brand_new_tool")).toBeInTheDocument();
    });
  });
});
