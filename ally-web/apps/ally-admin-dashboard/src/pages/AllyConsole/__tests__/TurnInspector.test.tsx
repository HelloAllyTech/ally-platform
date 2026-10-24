import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  traces: vi.fn(),
  releases: vi.fn(),
  turnTrace: vi.fn(),
  transcript: vi.fn(),
  payload: vi.fn(),
  access: { current: { canReadTranscripts: false } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideThreadTracesQuery: () => h.traces(),
  useGetAllyGuideReleasesQuery: () => h.releases(),
  useGetAllyGuideTurnTraceQuery: (id: string, options?: { skip?: boolean }) =>
    options?.skip ? { data: undefined } : h.turnTrace(id),
  useGetAllyGuideTranscriptQuery: () => h.transcript(),
  useGetAllyGuideTurnPayloadQuery: (id: string, options?: { skip?: boolean }) =>
    options?.skip ? { data: undefined, isFetching: false, isError: false } : h.payload(id),
}));

// eslint-disable-next-line import/first
import { TurnInspector } from "../TurnInspector";

const THREAD = {
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  trackId: "track-1",
  trackTitle: "New Counselor Foundations",
  tenantId: "tenant-a",
  tenantName: "Acme Counselling",
  visitor: false,
  mode: "CARE",
  status: "active",
  epoch: 2,
  arm: null,
  updatedAt: "2026-10-23T10:00:00.000Z",
  cursor: "2026-10-23T10:00:00.000000|11111111-aaaa-bbbb-cccc-000000000001",
  turns: 2,
  costUsd: 0.0731,
  crises: 1,
} as const;

const summary = (overrides: Record<string, unknown> = {}) => ({
  outcome: "completed",
  failure: null,
  stages: [
    { stage: "admit", startedAt: 1_000, ms: 12, outcome: "ok" },
    { stage: "sentinel", startedAt: 1_012, ms: 300, outcome: "ok" },
    { stage: "reply", startedAt: 1_312, ms: 1_500, outcome: "ok" },
    { stage: "persist", startedAt: 2_812, ms: 40, outcome: "skipped" },
  ],
  ttftMs: 840,
  durationMs: 1_852,
  replyKind: "chat",
  epoch: { number: 2, isNew: true, reason: "idle", historyMessages: 14 },
  model: "claude-sonnet-5-5",
  tier: "premium",
  modeBefore: "NORMAL",
  modeAfter: "CARE",
  restarted: false,
  steer: { level: 2, reason: "off the course for 4 turns" },
  sentinel: {
    risk: "care",
    about: "self",
    overlay: "none",
    confidence: 0.82,
    source: "classifier",
    latencyMs: 410,
  },
  tools: [
    { name: "present_item", isError: false },
    { name: "lookup_notes", isError: true },
  ],
  cards: [{ kind: "course_item", title: "Reflecting feelings" }],
  passes: 2,
  usage: { input: 1_200, output: 300, cacheRead: 9_000, cacheWrite: 500 },
  costUsd: 0.0312,
  spanHashes: null,
  ...overrides,
});

const TRACES = [
  // The API lists NEWEST first.
  {
    turnId: "turn-2",
    releaseId: "rel-3",
    createdAt: "2026-10-23T10:00:00.000Z",
    summary: summary(),
  },
  {
    turnId: "turn-1",
    releaseId: "rel-2",
    createdAt: "2026-10-23T09:55:00.000Z",
    summary: summary({ steer: { level: 0, reason: "first message" }, restarted: true }),
  },
];

const MESSAGES = [
  {
    id: "m1",
    seq: 1,
    role: "learner",
    kind: "chat",
    turnId: "turn-1",
    text: "I have been feeling low. Call me on [phone masked]",
    flags: { care: true },
    createdAt: "2026-10-23T09:55:00.000Z",
  },
  {
    id: "m2",
    seq: 2,
    role: "ally",
    kind: "chat",
    turnId: "turn-1",
    text: "Thank you for telling me.",
    flags: null,
    createdAt: "2026-10-23T09:55:03.000Z",
  },
  {
    id: "m3",
    seq: 3,
    role: "ally",
    kind: "crisis_fixed",
    turnId: "turn-2",
    text: "Support is available now.",
    flags: { crisis: true },
    createdAt: "2026-10-23T10:00:02.000Z",
  },
];

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
  ...extra,
});

const renderInspector = (
  threadId: string | null = THREAD.id,
  thread: Partial<Record<keyof typeof THREAD, unknown>> | undefined = threadId ? {} : undefined,
) =>
  render(
    <TurnInspector
      threadId={threadId}
      thread={thread ? ({ ...THREAD, ...thread } as never) : undefined}
      onClose={vi.fn()}
    />,
  );

describe("TurnInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canReadTranscripts: false };
    h.traces.mockReturnValue(ok(TRACES));
    h.releases.mockReturnValue(
      ok([
        { id: "rel-3", version: 3, status: "ga" },
        { id: "rel-2", version: 2, status: "retired" },
      ]),
    );
    h.turnTrace.mockImplementation((id: string) =>
      ok({
        turn: {
          id,
          trigger: "learner_message",
          channel: "voice",
          status: "completed",
          errorCode: null,
        },
        trace: { hasPayload: true, releaseId: "rel-3", summary: summary(), createdAt: "x" },
      }),
    );
    h.transcript.mockReturnValue(ok(MESSAGES));
    h.payload.mockReturnValue(
      ok(
        {
          situationReport: "steer: level 2 (off the course)",
          sentinelEvidence: { matched: "feeling low" },
          toolCalls: [{ name: "present_item", args: { itemId: "i1" }, result: "ok" }],
          reply: "Thank you for telling me.",
        },
        { isFetching: false },
      ),
    );
  });

  it("stays closed with no conversation chosen", () => {
    renderInspector(null);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("takes the organisation's name from the conversation row, which the server resolves", () => {
    renderInspector(THREAD.id, { tenantName: "Brightside" });

    expect(within(screen.getByRole("dialog")).getByText("Brightside")).toBeInTheDocument();
  });

  it("marks an anonymous visitor's conversation as one, and a canary one as a canary", () => {
    renderInspector(THREAD.id, { visitor: true, tenantName: null, tenantId: null, arm: "canary" });

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Visitor")).toBeInTheDocument();
    expect(dialog.getByText("Canary")).toBeInTheDocument();
  });

  it("marks neither for an ordinary signed-in conversation on the live release", () => {
    renderInspector();

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByText("Visitor")).not.toBeInTheDocument();
    expect(dialog.queryByText("Canary")).not.toBeInTheDocument();
  });

  it("names the conversation: course, organisation, mode, status, epoch, turns and cost", () => {
    renderInspector();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("New Counselor Foundations")).toBeInTheDocument();
    expect(within(dialog).getByText("Acme Counselling")).toBeInTheDocument();
    expect(within(dialog).getByText("Care")).toBeInTheDocument();
    expect(within(dialog).getByText("Active")).toBeInTheDocument();
    expect(within(dialog).getByText("Epoch 2")).toBeInTheDocument();
    expect(within(dialog).getByText("2 turns · $0.07")).toBeInTheDocument();
  });

  describe("transcripts depend on the per-person grant", () => {
    it("shows the redacted transcript beside the turns, and a payload button, with the grant", () => {
      h.access.current = { canReadTranscripts: true };
      renderInspector();

      const pane = screen.getByTestId("transcript-pane");
      expect(within(pane).getByText(/Redacted by the server/)).toBeInTheDocument();
      expect(within(pane).getAllByTestId("transcript-message")).toHaveLength(3);
      expect(within(pane).getByText(/\[phone masked\]/)).toBeInTheDocument();
      expect(screen.queryByTestId("transcripts-locked")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show payload" })).toBeInTheDocument();
      // Beside the turns, not instead of them.
      expect(screen.getAllByTestId("turn-card")).toHaveLength(2);
    });

    it("shows a quiet note instead, with no transcript and no payload button, without it", () => {
      h.access.current = { canReadTranscripts: false };
      renderInspector();

      expect(screen.getByTestId("transcripts-locked")).toHaveTextContent(
        "Transcripts are not open to you",
      );
      expect(screen.getByTestId("transcripts-locked")).toHaveTextContent(
        "per-person transcripts permission",
      );
      expect(screen.queryByTestId("transcript-pane")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Show payload" })).not.toBeInTheDocument();
      // Everything content-free is still there.
      expect(screen.getAllByTestId("turn-card")).toHaveLength(2);
      expect(screen.getByTestId("stage-waterfall")).toBeInTheDocument();
    });

    it("asks the server for neither the transcript nor a payload without the grant", () => {
      h.access.current = { canReadTranscripts: false };
      renderInspector();

      expect(h.transcript).not.toHaveBeenCalled();
      expect(h.payload).not.toHaveBeenCalled();
    });

    it("marks a transcript message as hidden or flagged in words, not only colour", () => {
      h.access.current = { canReadTranscripts: true };
      renderInspector();

      const pane = screen.getByTestId("transcript-pane");
      expect(within(pane).getByText("Care")).toBeInTheDocument();
      expect(within(pane).getByText("Crisis")).toBeInTheDocument();
      expect(within(pane).getByText("Fixed crisis reply")).toBeInTheDocument();
    });

    it("opens a turn when its message is chosen in the transcript", () => {
      h.access.current = { canReadTranscripts: true };
      renderInspector();
      // Only the latest turn starts open.
      expect(screen.getAllByTestId("turn-body")).toHaveLength(1);

      fireEvent.click(
        screen.getAllByRole("button", { name: /Learner: Show this turn's details/ })[0],
      );

      expect(screen.getAllByTestId("turn-body")).toHaveLength(2);
    });

    it("shows the transcript's own failure without losing the turns", () => {
      h.access.current = { canReadTranscripts: true };
      h.transcript.mockReturnValue(ok(undefined, { isError: true, error: { status: 500 } }));
      renderInspector();

      const pane = screen.getByTestId("transcript-pane");
      expect(within(pane).getByTestId("ally-load-failed")).toBeInTheDocument();
      expect(screen.getAllByTestId("turn-card")).toHaveLength(2);
    });

    it("says an empty conversation has no messages yet", () => {
      h.access.current = { canReadTranscripts: true };
      h.transcript.mockReturnValue(ok([]));
      renderInspector();

      expect(screen.getByTestId("transcript-empty")).toHaveTextContent("No messages");
    });
  });

  describe("the payload", () => {
    beforeEach(() => {
      h.access.current = { canReadTranscripts: true };
    });

    it("is fetched only when asked for, then shown in sections", () => {
      renderInspector();
      expect(h.payload).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Show payload" }));

      expect(h.payload).toHaveBeenCalledWith("turn-2");
      expect(screen.getByTestId("payload-situation")).toHaveTextContent("steer: level 2");
      expect(screen.getByTestId("payload-evidence")).toHaveTextContent('"matched": "feeling low"');
      expect(screen.getByTestId("payload-tool-call")).toHaveTextContent("present_item");
      expect(screen.getByTestId("payload-reply")).toHaveTextContent("Thank you for telling me.");
      expect(screen.getByRole("button", { name: "Hide payload" })).toBeInTheDocument();
    });

    it("says so quietly when the turn never had a payload stored", () => {
      h.turnTrace.mockImplementation((id: string) =>
        ok({
          turn: {
            id,
            trigger: "learner_message",
            channel: "text",
            status: "completed",
            errorCode: null,
          },
          trace: { hasPayload: false, releaseId: "rel-3", summary: summary(), createdAt: "x" },
        }),
      );
      renderInspector();

      expect(screen.getByTestId("payload-not-stored")).toHaveTextContent("No payload was stored");
      expect(screen.queryByRole("button", { name: "Show payload" })).not.toBeInTheDocument();
    });

    it("reads a 404 on request as 'nothing stored', not as a failure", () => {
      h.payload.mockReturnValue(
        ok(undefined, { isFetching: false, isError: true, error: { status: 404 } }),
      );
      renderInspector();

      fireEvent.click(screen.getByRole("button", { name: "Show payload" }));

      expect(screen.getByTestId("payload-not-stored")).toBeInTheDocument();
      expect(screen.queryByTestId("ally-load-failed")).not.toBeInTheDocument();
    });

    it("offers a retry for a real failure", () => {
      const refetch = vi.fn();
      h.payload.mockReturnValue(
        ok(undefined, { isFetching: false, isError: true, error: { status: 500 }, refetch }),
      );
      renderInspector();
      fireEvent.click(screen.getByRole("button", { name: "Show payload" }));

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(refetch).toHaveBeenCalled();
    });
  });

  describe("the turns", () => {
    it("lists them oldest first and opens only the latest", () => {
      renderInspector();

      const cards = screen.getAllByTestId("turn-card");
      expect(cards.map(card => card.id)).toEqual(["turn-turn-1", "turn-turn-2"]);
      expect(within(cards[0]).queryByTestId("turn-body")).not.toBeInTheDocument();
      expect(within(cards[1]).getByTestId("turn-body")).toBeInTheDocument();
    });

    it("draws the stage waterfall in text as well as bars, with the first token marked", () => {
      renderInspector();

      const rows = screen.getAllByTestId("stage-row");
      expect(
        rows.map(row => within(row).getByText(/^(admit|sentinel|reply|persist)$/).textContent),
      ).toEqual(["admit", "sentinel", "reply", "persist"]);
      expect(rows[2]).toHaveTextContent("1.50 s · ok");
      expect(rows[3]).toHaveTextContent("skipped");
      // A skipped stage has no bar to draw.
      expect(screen.getAllByTestId("stage-bar")).toHaveLength(3);
      expect(screen.getByTestId("first-token-row")).toHaveTextContent("840 ms");
    });

    it("shows steer with its meaning and reason, the Sentinel's verdict and the release as a version", () => {
      renderInspector();

      expect(screen.getByTestId("fact-steer")).toHaveTextContent(
        "Level 2 (one verbal bridge): off the course for 4 turns",
      );
      expect(screen.getByTestId("fact-release")).toHaveTextContent("v3");
      expect(screen.getByTestId("fact-model")).toHaveTextContent("claude-sonnet-5-5");
      expect(screen.getByTestId("fact-tier")).toHaveTextContent("premium");
      expect(screen.getByTestId("fact-mode")).toHaveTextContent("Normal to Care");
      expect(screen.getByTestId("fact-epoch")).toHaveTextContent(
        "2, new (idle) · 14 earlier messages in context",
      );
      const verdict = screen.getByTestId("sentinel-verdict");
      expect(verdict).toHaveTextContent("care");
      expect(verdict).toHaveTextContent("self");
      expect(verdict).toHaveTextContent("82%");
      expect(verdict).toHaveTextContent("classifier");
    });

    it("adds what the turn record knows: what started it and on which channel", () => {
      renderInspector();

      expect(screen.getByTestId("fact-trigger")).toHaveTextContent("Learner message");
      expect(screen.getByTestId("fact-channel")).toHaveTextContent("Voice");
    });

    it("lists tools, naming the one that failed, and the cards shown", () => {
      renderInspector();

      const tools = screen.getByTestId("turn-tools");
      expect(tools).toHaveTextContent("present_item");
      expect(tools).toHaveTextContent("lookup_notes · failed");
      expect(screen.getByTestId("turn-cards")).toHaveTextContent(
        "course_item · Reflecting feelings",
      );
    });

    it("shows tokens and cost", () => {
      renderInspector();

      const usage = screen.getByTestId("turn-usage");
      expect(usage).toHaveTextContent("1.2k");
      expect(usage).toHaveTextContent("9.0k");
      expect(usage).toHaveTextContent("$0.03");
    });

    it("says what went wrong on a failed turn, with the stage and code", () => {
      h.traces.mockReturnValue(
        ok([
          {
            ...TRACES[0],
            summary: summary({
              outcome: "failed",
              failure: {
                stage: "reply",
                code: "model_timeout",
                message: "The model took too long.",
              },
            }),
          },
        ]),
      );
      renderInspector();

      const failure = screen.getByTestId("turn-failure");
      expect(failure).toHaveTextContent("model_timeout in the reply stage");
      expect(failure).toHaveTextContent("The model took too long.");
    });

    it("flags a restarted turn in its header", () => {
      renderInspector();

      const [older] = screen.getAllByTestId("turn-card");
      expect(within(older).getByText("Restarted")).toBeInTheDocument();
    });

    it("falls back to a short release id when the release list does not know it", () => {
      h.releases.mockReturnValue(ok([]));
      renderInspector();

      expect(screen.getByTestId("fact-release")).toHaveTextContent("rel-3");
    });

    it("admits when the safety monitor did not run, instead of showing blank fields", () => {
      h.traces.mockReturnValue(
        ok([{ ...TRACES[0], summary: summary({ sentinel: null, steer: null }) }]),
      );
      renderInspector();

      expect(screen.getByText("The safety monitor did not run on this turn.")).toBeInTheDocument();
      expect(screen.getByTestId("fact-steer")).toHaveTextContent("No steer recorded");
    });
  });

  describe("states", () => {
    it("shows a skeleton while the turns load", () => {
      h.traces.mockReturnValue(ok(undefined, { isLoading: true }));
      renderInspector();

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    });

    it("says there is nothing to inspect yet when a conversation has no traces", () => {
      h.traces.mockReturnValue(ok([]));
      renderInspector();

      expect(screen.getByText("Nothing to inspect yet")).toBeInTheDocument();
    });

    it("tells a failed load from an empty one, and a forbidden one from both", () => {
      h.traces.mockReturnValue(ok(undefined, { isError: true, error: { status: 500 } }));
      const { unmount } = renderInspector();
      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      unmount();

      h.traces.mockReturnValue(ok(undefined, { isError: true, error: { status: 403 } }));
      renderInspector();
      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
    });

    it("says when the list is capped at the latest turns", () => {
      h.traces.mockReturnValue(
        ok(
          Array.from({ length: 50 }, (_, index) => ({
            ...TRACES[0],
            turnId: `turn-${index}`,
            createdAt: new Date(Date.UTC(2026, 9, 23, 10, 0, index)).toISOString(),
          })),
        ),
      );
      renderInspector();

      expect(
        screen.getByText("Showing the latest 50 turns. Older turns are not listed."),
      ).toBeInTheDocument();
    });

    it("still opens by id alone, as a deep link does, before the list has the row", async () => {
      render(<TurnInspector threadId="22222222-0000-0000-0000-000000000009" onClose={vi.fn()} />);

      expect(screen.getByText("22222222")).toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByTestId("turn-card")).toHaveLength(2));
    });
  });
});
