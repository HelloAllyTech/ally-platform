import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot, TestChatbotResponse } from "@types";

/**
 * Preview says which engine answered each test, shows the new engine's run id and steps, keeps the
 * engine's thread until "New thread", and lets only platform admins force an engine for one test.
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

    expect(screen.getByTestId("engine-badge")).toHaveTextContent("Answered by v2");
    expect(screen.getByText(nextResult.runId!)).toBeInTheDocument();
    expect(screen.getByText("Steps (3)")).toBeInTheDocument();
    expect(screen.getByText("retrieve · 120 ms")).toBeInTheDocument();
    expect(screen.getByText("write · 2100 ms")).toBeInTheDocument();
  });

  it("shows a v1 answer with no run, and a fallback with its reason", async () => {
    nextResult = result({ runtime: "v1", runId: null, trace: null, reply: "From v1." });
    render(<ChatbotTestTab bot={BOT} />);
    await ask("q1");
    expect(screen.getByTestId("engine-badge")).toHaveTextContent("Answered by v1");
    expect(screen.queryByText(/^Steps/)).not.toBeInTheDocument();

    nextResult = result({
      runtime: "v2_fallback",
      trace: null,
      fallbackReason: "upstream_404",
      reply: "Fell back.",
    });
    await ask("q2");
    expect(screen.getAllByTestId("engine-badge")[1]).toHaveTextContent(
      "Answered by v1 (v2 failed: upstream_404)",
    );
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

  it("offers the engine picker to platform admins only", async () => {
    render(<ChatbotTestTab bot={BOT} />);
    expect(screen.queryByLabelText("Engine for this test")).not.toBeInTheDocument();
    await ask("q");
    expect(testSpy.mock.calls[0][0]).not.toHaveProperty("runtime");
  });

  it("sends the forced engine for a platform admin's test", async () => {
    canCreate = true;
    render(<ChatbotTestTab bot={BOT} />);
    fireEvent.change(screen.getByLabelText("Engine for this test"), {
      target: { value: "v1" },
    });
    await ask("q");
    expect(testSpy.mock.calls[0][0]).toMatchObject({ runtime: "v1" });
  });
});
