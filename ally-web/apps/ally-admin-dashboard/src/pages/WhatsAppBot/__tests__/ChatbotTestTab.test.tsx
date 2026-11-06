import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot, TestChatbotResponse } from "@types";

/**
 * Preview says which engine answered each test, shows the new engine's run id and steps, and keeps
 * the engine's thread until "New thread". In Agent mode each step reads as its summary (tool calls
 * marked as such), and each reply says what the agent understood the message to be.
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

describe("ChatbotTestTab — engine and run", () => {
  beforeEach(() => {
    canCreate = false;
    testSpy.mockClear();
    nextResult = result();
  });

  it("shows the engine, the run id and the steps with their time", async () => {
    render(<ChatbotTestTab bot={BOT} />);
    await ask("What does Ally do?");

    expect(screen.getByTestId("engine-badge")).toHaveTextContent("Answered by the agent");
    expect(screen.getByText(nextResult.runId!)).toBeInTheDocument();
    expect(screen.getByText("Steps (3)")).toBeInTheDocument();
    expect(screen.getByText("retrieve · 120 ms")).toBeInTheDocument();
    expect(screen.getByText("write · 2100 ms")).toBeInTheDocument();
  });

  it("shows a v1 answer with no run, and a fallback with its reason", async () => {
    nextResult = result({ runtime: "v1", runId: null, trace: null, reply: "From v1." });
    render(<ChatbotTestTab bot={BOT} />);
    await ask("q1");
    expect(screen.getByTestId("engine-badge")).toHaveTextContent("Answered by the backup engine");
    expect(screen.queryByText(/^Steps/)).not.toBeInTheDocument();

    nextResult = result({
      runtime: "v2_fallback",
      trace: null,
      fallbackReason: "upstream_404",
      reply: "Fell back.",
    });
    await ask("q2");
    expect(screen.getAllByTestId("engine-badge")[1]).toHaveTextContent(
      "Answered by the backup engine (the agent failed: upstream_404)",
    );
  });

  it("tells platform admins, and only them, when the agent is switched off", async () => {
    nextResult = result({ runtime: "v1", runtimeAllowed: false, runId: null, trace: null });
    const { unmount } = render(<ChatbotTestTab bot={BOT} />);
    await ask("q");
    expect(screen.queryByText(/switched off in Defaults/)).not.toBeInTheDocument();
    unmount();

    canCreate = true;
    render(<ChatbotTestTab bot={BOT} />);
    await ask("q");
    expect(
      screen.getByText(
        "The agent is switched off in Defaults, so every test answers with the backup engine.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the thread across a conversation and drops it on New thread", async () => {
    render(<ChatbotTestTab bot={BOT} />);
    await ask("first");
    nextResult = result({ reply: "second answer" });
    await ask("second");
    expect(testSpy.mock.calls[0][0]).toMatchObject({ conversationId: undefined });
    expect(testSpy.mock.calls[1][0]).toMatchObject({
      conversationId: "preview-7b0c1b8e-8a43-4f61-9a43-3a2d5c0f9e11",
    });

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    await waitFor(() => expect(screen.queryByText("second answer")).not.toBeInTheDocument());
    nextResult = result({ reply: "fresh" });
    await ask("third");
    expect(testSpy.mock.calls[2][0]).toMatchObject({ conversationId: undefined });
  });

  it("sends only the last 10 messages of a long thread", async () => {
    render(<ChatbotTestTab bot={BOT} />);
    for (let i = 0; i < 8; i++) {
      nextResult = result({ reply: `reply ${i}` });
      await ask(`question ${i}`);
    }
    // 16 messages on screen; the 9th test sends only the most recent 10.
    await ask("question 8");
    const history = testSpy.mock.calls[8][0].history;
    expect(history).toHaveLength(10);
    expect(history[0]).toEqual({ role: "user", content: "question 3" });
    expect(history[9]).toEqual({ role: "assistant", content: "reply 7" });
  });

  it("has no engine picker and always tests the chatbot's own engine", async () => {
    canCreate = true;
    render(<ChatbotTestTab bot={BOT} />);
    expect(screen.queryByLabelText("Engine for this test")).not.toBeInTheDocument();
    await ask("q");
    expect(testSpy.mock.calls[0][0]).not.toHaveProperty("runtime");
  });
});

describe("ChatbotTestTab — Agent mode", () => {
  beforeEach(() => {
    canCreate = false;
    testSpy.mockClear();
    nextResult = result({
      turnType: "question",
      trace: [
        {
          node: "agent",
          ms: 1900,
          summary: "agent: question, calls search_knowledge via gpt-5-mini",
        },
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
    expect(
      screen.getByText("agent: question, calls search_knowledge via gpt-5-mini · 1900 ms"),
    ).toBeInTheDocument();
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
