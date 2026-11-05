import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot, TestChatbotResponse } from "@types";

/**
 * Preview in Agent mode: each step reads as its summary (tool calls marked as such), and each
 * reply says what the agent understood the message to be.
 */

let canCreate = false;
const testSpy = vi.fn();
let nextResult: TestChatbotResponse;

// The real copy, without the whole constants barrel (which cannot load in isolation).
vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  TooltipLocation: {},
}));

vi.mock("@components", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@api", () => ({
  useGetChatbotsQuery: () => ({ data: { chatbots: [], canCreate } }),
  useTestChatbotMutation: () => [
    (args: unknown) => {
      testSpy(args);
      return { unwrap: async () => nextResult };
    },
    { isLoading: false },
  ],
}));

const { ChatbotTestTab } = await import("../ChatbotTestTab");

const BOT = { id: "bot-1", name: "Ally FAQ" } as Chatbot;

const result = (over: Partial<TestChatbotResponse> = {}): TestChatbotResponse => ({
  reply: "Ally trains counsellors.",
  handledBy: "rag" as TestChatbotResponse["handledBy"],
  citations: [],
  retrieval: null,
  language: "en",
  wouldFileUnanswered: null,
  wouldAlert: null,
  latencyMs: 2300,
  usedDraft: false,
  runtime: "v2",
  runId: "4c1d7a52-0d4e-5a3b-9f7e-2a6b8c1d0e9f",
  trace: [
    { node: "translate", ms: 1, summary: "" },
    { node: "retrieve", ms: 120, summary: "" },
    { node: "write", ms: 2100, summary: "" },
  ],
  fallbackReason: null,
  runtimeAllowed: true,
  conversationId: "preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11",
  ...over,
});

const ask = async (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Type a question…"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(nextResult.reply);
};

describe("ChatbotTestTab — Agent mode", () => {
  beforeEach(() => {
    canCreate = false;
    testSpy.mockClear();
    nextResult = result({
      turnType: "question",
      trace: [
        { node: "contextualize", ms: 410, summary: "contextualize: question, en, rewritten" },
        { node: "prefetch", ms: 150, summary: "prefetch: 0 hits, 0 passages" },
        { node: "agent", ms: 1900, summary: "agent: calls search_knowledge via gpt-5-mini" },
        {
          node: "tool",
          ms: 640,
          summary: "search_knowledge: 2 hits, 2 new passages, best 0.61",
        },
      ],
    });
  });

  it("shows tool steps with their summary and time", async () => {
    render(<ChatbotTestTab bot={BOT} />);
    await ask("and after that, how do I sign in?");
    expect(
      screen.getByText("tool · search_knowledge: 2 hits, 2 new passages, best 0.61 · 640 ms"),
    ).toBeInTheDocument();
    expect(screen.getByText("contextualize: question, en, rewritten · 410 ms")).toBeInTheDocument();
  });

  it("shows the turn type next to the engine badge", async () => {
    nextResult = result({ turnType: "smalltalk", trace: [], reply: "Hi there!" });
    render(<ChatbotTestTab bot={BOT} />);
    await ask("hello");
    expect(screen.getByTestId("turn-type")).toHaveTextContent("Small talk");
  });

  it("shows no turn type when the agent did not answer", async () => {
    nextResult = result({ turnType: null });
    render(<ChatbotTestTab bot={BOT} />);
    await ask("What does Ally do?");
    expect(screen.queryByTestId("turn-type")).not.toBeInTheDocument();
  });
});
