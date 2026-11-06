import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot, TestChatbotResponse } from "@types";

/**
 * Preview over the stream: the agent's activity in words as it happens (searching for what, found
 * where, checking, rewriting and why), the raw steps for platform admins, the checked text typed
 * out, then the final reply in its place — replacing whatever was shown — with the activity
 * folded into "Worked for … · N steps". A stream that never starts falls back to /test; one that started
 * is never re-sent.
 */

let canCreate = true;
const testSpy = vi.fn();
let plainResult: TestChatbotResponse;

vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  TooltipLocation: {},
  ApiEndpoints: {
    CHATBOTS: { TEST_STREAM: (id: string) => `/v1/chatbots/${id}/test/stream` },
    AUTH: { REFRESH: "/v1/auth/refresh" },
  },
  HttpMethod: { POST: "POST" },
  LOCAL_STORAGE_KEYS: { ADMIN_ACCESS_TOKEN: "access", ADMIN_REFRESH_TOKEN: "refresh" },
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
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now", logger: { warn: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", () => ({
  useGetChatbotsQuery: () => ({ data: { chatbots: [], canCreate } }),
  useTestChatbotMutation: () => [
    (args: unknown) => {
      testSpy(args);
      return { unwrap: async () => plainResult };
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
  runId: "run-1",
  trace: [{ node: "agent", ms: 900, summary: "agent: question, answer" }],
  fallbackReason: null,
  runtimeAllowed: true,
  conversationId: "preview-1",
  ...over,
});

/** A stream the test feeds event by event. */
const controlledStream = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200 }),
    send: (event: string, data: unknown) =>
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => controller.close(),
  };
};

const ask = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Type a question…"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

describe("ChatbotTestTab — streamed replies", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    canCreate = true;
    testSpy.mockClear();
    plainResult = result({ reply: "From /test." });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the status live, fills in the steps, reveals the text, then the final reply", async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    render(<ChatbotTestTab bot={BOT} />);
    ask("how do I get access?");

    expect(await screen.findByTestId("status-line")).toHaveTextContent("Reading your question");

    stream.send("run_started", { run_id: "run-1" });
    stream.send("status", { code: "thinking", label: "x" });
    stream.send("status", { code: "searching", label: "x", detail: "getting access" });
    await waitFor(() =>
      expect(screen.getByTestId("status-line")).toHaveTextContent(
        "Searching the knowledge base for “getting access”",
      ),
    );

    stream.send("step", { node: "tool", ms: 140, summary: "search_knowledge: 3 hits" });
    expect(await screen.findByTestId("live-steps")).toHaveTextContent(
      "tool · search_knowledge: 3 hits · 140 ms",
    );
    stream.send("status", {
      code: "found",
      label: "x",
      detail: "2 passages",
      documents: ["Getting Access and Signing In"],
    });
    stream.send("status", { code: "thinking", label: "x" });
    stream.send("status", { code: "rewriting", label: "x", detail: "search_first" });
    stream.send("status", { code: "checking", label: "x" });
    await waitFor(() =>
      expect(screen.getByTestId("status-line")).toHaveTextContent(
        "Checking the answer against the sources",
      ),
    );
    // Every line so far, done ones included, in words.
    expect(screen.getByTestId("activity")).toHaveTextContent(
      "Found 2 passages in Getting Access and Signing In",
    );
    expect(screen.getByTestId("activity")).toHaveTextContent("Working out the answer");
    expect(screen.getByTestId("activity")).toHaveTextContent(
      "Rewriting: it answered before searching",
    );

    stream.send("token", { text: "Ally trains" });
    stream.send("token", { text: " counsellors." });
    await waitFor(() =>
      expect(screen.getByTestId("revealed-text")).toHaveTextContent("Ally trains counsellors."),
    );

    stream.send("final", result());
    stream.close();
    await waitFor(() => expect(screen.queryByTestId("pending-reply")).toBeNull());
    expect(screen.getByText("Ally trains counsellors.")).toBeInTheDocument();
    expect(screen.queryByTestId("replaced-note")).toBeNull();
    // The activity stays with the reply, folded away.
    expect(screen.getByTestId("worked")).toHaveTextContent(/Worked for \d+\.\d s · 6 steps/);
    expect(testSpy).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/chatbots/bot-1/test/stream");
    expect(JSON.parse(init.body)).toMatchObject({ message: "how do I get access?" });
  });

  it("replaces the shown text when the final reply differs", async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    render(<ChatbotTestTab bot={BOT} />);
    ask("hello");

    stream.send("run_started", { run_id: "run-1" });
    stream.send("token", { text: "Draft words." });
    await screen.findByTestId("revealed-text");
    stream.send("final", result({ reply: "It sounds like this may be urgent." }));
    stream.close();

    expect(await screen.findByText("It sounds like this may be urgent.")).toBeInTheDocument();
    expect(screen.queryByText("Draft words.")).toBeNull();
    expect(screen.getByTestId("replaced-note")).toHaveTextContent("Updated with the final reply");
  });

  it("shows the steps live to platform admins only", async () => {
    canCreate = false;
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    render(<ChatbotTestTab bot={BOT} />);
    ask("hi");

    stream.send("step", { node: "agent", ms: 10, summary: "agent: smalltalk" });
    stream.send("status", { code: "checking", label: "x" });
    // Everyone sees the activity in words; only the raw steps are for platform admins.
    await waitFor(() =>
      expect(screen.getByTestId("status-line")).toHaveTextContent(
        "Checking the answer against the sources",
      ),
    );
    expect(screen.queryByTestId("live-steps")).toBeNull();
    stream.send("final", result());
    stream.close();
  });

  it("falls back to /test when the stream does not start", async () => {
    fetchMock.mockResolvedValue(new Response("Not found", { status: 404 }));
    render(<ChatbotTestTab bot={BOT} />);
    ask("how do I get access?");

    expect(await screen.findByText("From /test.")).toBeInTheDocument();
    expect(testSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bot-1", message: "how do I get access?" }),
    );
  });

  it("falls back to /test when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ChatbotTestTab bot={BOT} />);
    ask("hi");

    expect(await screen.findByText("From /test.")).toBeInTheDocument();
  });

  it("never sends the message twice once the stream has started", async () => {
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    render(<ChatbotTestTab bot={BOT} />);
    ask("hi");

    stream.send("run_started", { run_id: "run-1" });
    stream.close();

    expect(await screen.findByText("The test failed.")).toBeInTheDocument();
    expect(testSpy).not.toHaveBeenCalled();
  });
});
