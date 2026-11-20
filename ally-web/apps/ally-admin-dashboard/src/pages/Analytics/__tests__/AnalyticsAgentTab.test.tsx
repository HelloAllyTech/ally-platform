import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * Carbon charts draw through d3, which captures `requestAnimationFrame` at import
 * time and then reaches into SVG geometry jsdom does not implement. Hoisted stub,
 * for the same reason the sibling chart-render test hoists one: a `beforeAll`
 * runs after d3 has already taken its copy.
 */
vi.hoisted(() => {
  if (typeof window !== "undefined") {
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  }
});

const askMock = vi.fn();
const fetchConversationMock = vi.fn();
const feedbackMock = vi.fn();
// What the sidebar's list query returns; each test sets its own.
let savedConversations: { id: string; title: string; createdAt: string; updatedAt: string }[] = [];

// Partial mock: the store wires every other slice off `@api`, so replacing the
// whole module would take the app's store down with it. Only the two hooks this
// tab calls are stubbed.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useAskAnalyticsAgentMutation: () => [askMock, { isLoading: false }],
  useGetAnalyticsAgentConversationsQuery: () => ({
    data: savedConversations,
    isLoading: false,
    isError: false,
  }),
  useLazyGetAnalyticsAgentConversationQuery: () => [fetchConversationMock],
  useSetAnalyticsAgentFeedbackMutation: () => [feedbackMock, { isLoading: false }],
  useGetAnalyticsAgentCatalogQuery: () => ({
    data: {
      tables: [
        { name: "scenario_sessions", purpose: "One simulated roleplay run.", columns: ["id"] },
      ],
      deniedColumns: ["password", "email"],
      rowLimit: 500,
    },
    isLoading: false,
    isError: false,
  }),
}));

import { en } from "@constants";
import { AskAnalyticsAgentResponse } from "@types";

import { AnalyticsAgentTab } from "../tabs/AnalyticsAgentTab";

const strings = en.analyticsAgent;

const response = (
  overrides: Partial<AskAnalyticsAgentResponse> = {},
): AskAnalyticsAgentResponse => ({
  outcome: "answer",
  question: "How many sessions last week?",
  message: "",
  answer: "There were **412** sessions last week.",
  sql: "SELECT count(*) AS n FROM scenario_sessions LIMIT 1",
  rationale: "Counts sessions started in the last 7 days.",
  columns: ["n"],
  rows: [{ n: 412 }],
  rowCount: 1,
  truncated: false,
  chart: null,
  caveats: [],
  followUps: [],
  durationMs: 31,
  provenance: { plannerModel: "planner-x", answerModel: "answer-y", promptVersion: "v1" },
  ...overrides,
});

/** Resolve `ask(...)` the way RTK Query's mutation trigger does. */
const resolveWith = (value: AskAnalyticsAgentResponse) =>
  askMock.mockReturnValue({ unwrap: () => Promise.resolve(value) });

const rejectWith = (error: unknown) =>
  askMock.mockReturnValue({ unwrap: () => Promise.reject(error) });

/**
 * Wait for an answered turn to land.
 *
 * Deliberately not "wait for the number": a figure in the answer prose also
 * appears in the result table below it, so matching on it is ambiguous — which is
 * the app being right and the assertion being lazy.
 */
const answered = async () =>
  waitFor(() => expect(screen.getAllByText(strings.showQuery).length).toBeGreaterThan(0));

const ask = async (question: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(strings.inputPlaceholder), question);
  await user.click(screen.getByRole("button", { name: strings.send }));
  return user;
};

describe("AnalyticsAgentTab", () => {
  beforeEach(() => {
    askMock.mockReset();
    fetchConversationMock.mockReset();
    feedbackMock.mockReset();
    feedbackMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    savedConversations = [];
  });

  it("teaches what it can do before the first question", () => {
    render(<AnalyticsAgentTab />);

    expect(screen.getByText(strings.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(strings.emptySubtitle)).toBeInTheDocument();
    // Sample questions are the fastest way to learn what is answerable.
    expect(screen.getByRole("button", { name: strings.samples[0] })).toBeInTheDocument();
  });

  it("states what is readable, and the policy on what never is", () => {
    render(<AnalyticsAgentTab />);

    expect(screen.getByText("scenario_sessions")).toBeInTheDocument();
    expect(screen.getByText(strings.scopeDeniedIntro)).toBeInTheDocument();
  });

  it("shows the question and then the answer, with the SQL available", async () => {
    resolveWith(response());
    render(<AnalyticsAgentTab />);

    await ask("How many sessions last week?");

    // The question stays on screen — a thread, not a single-shot box.
    expect(screen.getByText("How many sessions last week?")).toBeInTheDocument();
    await answered();
    // The answer prose is rendered from markdown. Matched on wording the
    // question does not share, so this cannot pass by finding the question.
    expect(screen.getByText(/There were/)).toBeInTheDocument();
    // ...and the figure appears twice on purpose: in the prose and in the table
    // of rows underneath it.
    expect(screen.getAllByText(/412/).length).toBeGreaterThanOrEqual(2);
    // The SQL is one click away, so the number is checkable without leaving.
    expect(screen.getByText(strings.showQuery)).toBeInTheDocument();
  });

  it("names the models that produced the answer", async () => {
    resolveWith(response());
    render(<AnalyticsAgentTab />);

    await ask("q");

    await waitFor(() => expect(screen.getByText(/planner-x/)).toBeInTheDocument());
    expect(screen.getByText(/answer-y/)).toBeInTheDocument();
  });

  it("renders caveats next to the answer rather than hiding them", async () => {
    resolveWith(response({ caveats: ["Only 7 evaluated sessions in this period."] }));
    render(<AnalyticsAgentTab />);

    await ask("q");

    await waitFor(() =>
      expect(screen.getByText("Only 7 evaluated sessions in this period.")).toBeInTheDocument(),
    );
    expect(screen.getByText(strings.caveatsTitle)).toBeInTheDocument();
  });

  it("says so when the result was capped, where the numbers are", async () => {
    resolveWith(
      response({
        columns: ["org", "n"],
        rows: Array.from({ length: 500 }, (_, i) => ({ org: `org-${i}`, n: i })),
        rowCount: 500,
        truncated: true,
      }),
    );
    render(<AnalyticsAgentTab />);

    await ask("every org");

    await waitFor(() => expect(screen.getByText(/the full result is larger/)).toBeInTheDocument());
  });

  it("treats a clarifying question as information, not an error", async () => {
    resolveWith(
      response({ outcome: "clarify", answer: "", message: "Which period did you mean?" }),
    );
    render(<AnalyticsAgentTab />);

    await ask("how are we doing?");

    await waitFor(() => expect(screen.getByText(strings.clarifyTitle)).toBeInTheDocument());
    expect(screen.getByText("Which period did you mean?")).toBeInTheDocument();
  });

  it("shows the refused SQL, so a rejection can be understood", async () => {
    resolveWith(
      response({
        outcome: "rejected",
        answer: "",
        message: 'I could not run that safely: the query referenced "email".',
        sql: "SELECT email FROM users LIMIT 10",
        rows: [],
        rowCount: 0,
        columns: [],
      }),
    );
    render(<AnalyticsAgentTab />);

    await ask("list emails");

    await waitFor(() => expect(screen.getByText(strings.rejectedTitle)).toBeInTheDocument());
    expect(screen.getByText(strings.showQuery)).toBeInTheDocument();
  });

  it("keeps a failed turn in the thread instead of a toast that vanishes", async () => {
    rejectWith(new Error("network down"));
    render(<AnalyticsAgentTab />);

    await ask("anything");

    await waitFor(() => expect(screen.getByText(strings.requestFailed)).toBeInTheDocument());
    // The question is still there to retype or narrow.
    expect(screen.getByText("anything")).toBeInTheDocument();
  });

  it("sends prior answered turns as context, so a follow-up resolves", async () => {
    resolveWith(response());
    render(<AnalyticsAgentTab />);

    await ask("How many sessions last week?");
    await answered();

    resolveWith(response({ question: "and by language?", answer: "English leads." }));
    await ask("and by language?");

    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(2));
    const secondCall = askMock.mock.calls[1][0];
    expect(secondCall.question).toBe("and by language?");
    expect(secondCall.history).toHaveLength(1);
    expect(secondCall.history[0].question).toBe("How many sessions last week?");
    expect(secondCall.history[0].sql).toContain("scenario_sessions");
  }, 15000); // 5000ms budget under the full-suite's parallel load. // single-ask siblings' work, which is what tips it over the default // Two full userEvent.type()+click+waitFor cycles — roughly double its

  it("does not send a failed turn as context", async () => {
    // Replaying a failure would teach the planner to repeat it.
    rejectWith(new Error("network down"));
    render(<AnalyticsAgentTab />);
    await ask("first");
    await waitFor(() => expect(screen.getByText(strings.requestFailed)).toBeInTheDocument());

    resolveWith(response());
    await ask("second");

    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(2));
    expect(askMock.mock.calls[1][0].history).toEqual([]);
  });

  it("asks a suggested follow-up on one click", async () => {
    resolveWith(response({ followUps: ["And by organisation?"] }));
    render(<AnalyticsAgentTab />);

    await ask("sessions?");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "And by organisation?" })).toBeInTheDocument(),
    );

    resolveWith(response({ question: "And by organisation?" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "And by organisation?" }));

    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(2));
    expect(askMock.mock.calls[1][0].question).toBe("And by organisation?");
  });

  const saved = (id: string, title: string) => ({
    id,
    title,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  });

  describe("saved conversations", () => {
    it("lists earlier conversations by their first question", () => {
      savedConversations = [saved("c1", "Sessions last week"), saved("c2", "AI spend by model")];
      render(<AnalyticsAgentTab />);

      expect(screen.getByRole("button", { name: "Sessions last week" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "AI spend by model" })).toBeInTheDocument();
      // Said where the list is, so nobody wonders who else can see it.
      expect(screen.getByText(strings.historyPrivacy)).toBeInTheDocument();
    });

    it("says so when there are no saved conversations yet", () => {
      render(<AnalyticsAgentTab />);

      expect(screen.getByText(strings.historyEmpty)).toBeInTheDocument();
    });

    it("reopens a saved conversation exactly as it was answered", async () => {
      savedConversations = [saved("c1", "Sessions last week")];
      fetchConversationMock.mockReturnValue({
        unwrap: () =>
          Promise.resolve({
            ...saved("c1", "Sessions last week"),
            messages: [
              {
                id: "m1",
                question: "How many sessions last week?",
                outcome: "answer",
                response: response({ conversationId: "c1" }),
                createdAt: "2026-11-01T10:00:00.000Z",
              },
            ],
          }),
      });
      render(<AnalyticsAgentTab />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Sessions last week" }));

      expect(fetchConversationMock).toHaveBeenCalledWith("c1");
      expect(await screen.findByText("How many sessions last week?")).toBeInTheDocument();
      await answered();
      expect(screen.getByRole("button", { name: "Sessions last week" })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    it("continues an opened conversation rather than starting another", async () => {
      savedConversations = [saved("c1", "Sessions last week")];
      fetchConversationMock.mockReturnValue({
        unwrap: () =>
          Promise.resolve({
            ...saved("c1", "Sessions last week"),
            messages: [
              {
                id: "m1",
                question: "How many sessions last week?",
                outcome: "answer",
                response: response({ conversationId: "c1" }),
                createdAt: "2026-11-01T10:00:00.000Z",
              },
            ],
          }),
      });
      render(<AnalyticsAgentTab />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Sessions last week" }));
      await answered();

      resolveWith(response({ conversationId: "c1" }));
      await ask("and by organisation?");

      await waitFor(() => expect(askMock).toHaveBeenCalledTimes(1));
      const call = askMock.mock.calls[0][0];
      expect(call.conversationId).toBe("c1");
      // The reopened turn is context for the follow-up, same as a live one.
      expect(call.history[0].question).toBe("How many sessions last week?");
    });

    it("starts a conversation on the first question and keeps adding to it", async () => {
      resolveWith(response({ conversationId: "new-conv" }));
      render(<AnalyticsAgentTab />);

      await ask("first question");
      await answered();
      await waitFor(() => expect(askMock).toHaveBeenCalledTimes(1));
      expect(askMock.mock.calls[0][0].conversationId).toBeUndefined();

      resolveWith(response({ conversationId: "new-conv" }));
      await ask("second question");

      await waitFor(() => expect(askMock).toHaveBeenCalledTimes(2));
      expect(askMock.mock.calls[1][0].conversationId).toBe("new-conv");
    }, 15000);

    it("starts clean on New conversation — no thread, no history, no conversation id", async () => {
      resolveWith(response({ conversationId: "conv-1" }));
      render(<AnalyticsAgentTab />);
      await ask("How many sessions last week?");
      await answered();

      const user = userEvent.setup();
      // No confirmation: the old thread is saved and stays in the list.
      await user.click(screen.getByRole("button", { name: strings.newConversation }));

      expect(screen.queryByText("How many sessions last week?")).not.toBeInTheDocument();
      // Back to the state that teaches.
      expect(screen.getByText(strings.emptyTitle)).toBeInTheDocument();

      resolveWith(response({ conversationId: "conv-2" }));
      await ask("fresh question");

      await waitFor(() => expect(askMock).toHaveBeenCalledTimes(2));
      expect(askMock.mock.calls[1][0].history).toEqual([]);
      expect(askMock.mock.calls[1][0].conversationId).toBeUndefined();
    }, 15000);

    it("says so when a conversation cannot be opened, and leaves the thread alone", async () => {
      savedConversations = [saved("c1", "Sessions last week")];
      fetchConversationMock.mockReturnValue({ unwrap: () => Promise.reject(new Error("500")) });
      render(<AnalyticsAgentTab />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Sessions last week" }));

      expect(await screen.findByText(strings.conversationLoadFailed)).toBeInTheDocument();
      expect(screen.getByText(strings.emptyTitle)).toBeInTheDocument();
    });
  });

  it("says the query matched nothing rather than showing an empty table", async () => {
    resolveWith(
      response({
        answer: "No sessions were completed in that period.",
        columns: [],
        rows: [],
        rowCount: 0,
      }),
    );
    render(<AnalyticsAgentTab />);

    await ask("sessions in 2019?");

    await waitFor(() => expect(screen.getByText(strings.emptyResult)).toBeInTheDocument());
  });

  describe("feedback on an answer", () => {
    const up = () => screen.getByRole("button", { name: strings.feedbackUp });
    const down = () => screen.getByRole("button", { name: strings.feedbackDown });

    it("offers a thumbs up and down on a saved answer, and sends nothing until one is used", async () => {
      resolveWith(response({ messageId: "msg-1" }));
      render(<AnalyticsAgentTab />);

      await ask("How many sessions last week?");
      await answered();

      expect(up()).toHaveAttribute("aria-pressed", "false");
      expect(down()).toHaveAttribute("aria-pressed", "false");
      // Feedback is optional: answering never records one by itself.
      expect(feedbackMock).not.toHaveBeenCalled();
    });

    it("has nothing to rate when the turn was not saved", async () => {
      resolveWith(response());
      render(<AnalyticsAgentTab />);

      await ask("q");
      await answered();

      expect(screen.queryByRole("button", { name: strings.feedbackUp })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: strings.feedbackDown })).not.toBeInTheDocument();
    });

    it("records a thumbs up against the saved turn", async () => {
      resolveWith(response({ messageId: "msg-1" }));
      render(<AnalyticsAgentTab />);
      const user = await ask("q");
      await answered();

      await user.click(up());

      expect(feedbackMock).toHaveBeenCalledWith({ messageId: "msg-1", feedback: "up" });
      expect(up()).toHaveAttribute("aria-pressed", "true");
      expect(down()).toHaveAttribute("aria-pressed", "false");
    });

    it("changes a rating, and takes it back when the same thumb is tapped again", async () => {
      resolveWith(response({ messageId: "msg-1" }));
      render(<AnalyticsAgentTab />);
      const user = await ask("q");
      await answered();

      await user.click(up());
      await user.click(down());
      expect(feedbackMock).toHaveBeenLastCalledWith({ messageId: "msg-1", feedback: "down" });
      expect(down()).toHaveAttribute("aria-pressed", "true");
      expect(up()).toHaveAttribute("aria-pressed", "false");

      await user.click(down());
      expect(feedbackMock).toHaveBeenLastCalledWith({ messageId: "msg-1", feedback: null });
      expect(down()).toHaveAttribute("aria-pressed", "false");
    });

    it("puts the buttons back and says so when the rating could not be saved", async () => {
      resolveWith(response({ messageId: "msg-1" }));
      feedbackMock.mockReturnValue({ unwrap: () => Promise.reject(new Error("500")) });
      render(<AnalyticsAgentTab />);
      const user = await ask("q");
      await answered();

      await user.click(down());

      expect(await screen.findByText(strings.feedbackFailed)).toBeInTheDocument();
      expect(down()).toHaveAttribute("aria-pressed", "false");
    });

    it("shows the rating a reopened conversation already has", async () => {
      savedConversations = [saved("c1", "Sessions last week")];
      fetchConversationMock.mockReturnValue({
        unwrap: () =>
          Promise.resolve({
            ...saved("c1", "Sessions last week"),
            messages: [
              {
                id: "m1",
                question: "How many sessions last week?",
                outcome: "answer",
                response: response({ conversationId: "c1" }),
                feedback: "down",
                createdAt: "2026-11-01T10:00:00.000Z",
              },
            ],
          }),
      });
      render(<AnalyticsAgentTab />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Sessions last week" }));
      await answered();

      expect(down()).toHaveAttribute("aria-pressed", "true");
      expect(up()).toHaveAttribute("aria-pressed", "false");
      // A reopened turn is rated against its own saved id.
      await user.click(down());
      expect(feedbackMock).toHaveBeenCalledWith({ messageId: "m1", feedback: null });
    });
  });
});
