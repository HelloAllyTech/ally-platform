import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  releases: vi.fn(),
  run: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideReleasesQuery: () => h.releases(),
  useRunAllyGuidePlaygroundMutation: () => [h.run, { isLoading: false }],
  useGetTenantsQuery: () => ({ data: { data: [{ id: "org-1", name: "Acme Helpline" }] } }),
  useGetTracksQuery: () => ({
    data: { data: [{ id: "t-1", title: "Active listening" }], count: 1 },
    isLoading: false,
    isError: false,
  }),
}));

// eslint-disable-next-line import/first
import { PlaygroundTab } from "../PlaygroundTab";

const release = (id: string, version: number, status: string) => ({
  id,
  version,
  status,
  contentHash: "abc",
  authorKind: "human",
  notes: null,
  promotedAt: null,
  retiredAt: null,
  createdAt: "2026-10-19T09:00:00.000Z",
});

const RELEASES = [
  release("rel-4", 4, "draft"),
  release("rel-3", 3, "ga"),
  release("rel-2", 2, "retired"),
];

const answer = (version: number, reply: string, extra: Record<string, unknown> = {}) => ({
  release: { id: `rel-${version}`, version, status: "ga" },
  reply,
  replyKind: "model",
  sentinel: {
    risk: "none",
    about: "none",
    overlay: null,
    confidence: 0.9,
    source: "rules",
    latencyMs: 4,
  },
  situation: `Turn 1 situation for v${version}`,
  toolCalls: [],
  model: "claude-sonnet-5-5",
  usage: [{ inputTokens: 100, outputTokens: 20, cachedTokens: 50 }],
  costUsd: 0.0123,
  latencyMs: 6200,
  ...extra,
});

/** Each release answers its own way, so a column can be told from the other. */
const respond = (body: { releaseId: string }) => {
  const version = body.releaseId === "rel-3" ? 3 : 4;
  return {
    unwrap: () => Promise.resolve(answer(version, `Reply from v${version}`)),
    abort: vi.fn(),
  };
};

const pickCourse = () =>
  fireEvent.change(screen.getByLabelText("Choose a course"), { target: { value: "t-1" } });

const say = (text: string) =>
  fireEvent.change(screen.getByLabelText("What the learner says"), { target: { value: text } });

describe("PlaygroundTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.releases.mockReturnValue({
      data: RELEASES,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    h.run.mockImplementation(respond);
  });

  describe("access and states", () => {
    it("explains that running needs the edit permission, instead of showing a form that would fail", () => {
      h.access.current = { canEdit: false };
      render(<PlaygroundTab />);

      expect(screen.getByTestId("ally-playground-needs-edit")).toHaveTextContent(
        "needs the edit permission",
      );
      expect(screen.queryByLabelText("What the learner says")).not.toBeInTheDocument();
    });

    it("shows a skeleton while the releases load", () => {
      h.releases.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<PlaygroundTab />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    });

    it("tells a failed load from an empty one, with a retry", () => {
      const refetch = vi.fn();
      h.releases.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<PlaygroundTab />);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe("the setup", () => {
    it("starts with the live release as A and the newest draft as B, so the first run compares the change", () => {
      render(<PlaygroundTab />);

      expect(screen.getByLabelText("Release A")).toHaveValue("rel-3");
      expect(screen.getByLabelText("Release B")).toHaveValue("rel-4");
      expect(screen.getByTestId("pane-rel-3")).toHaveTextContent("v3");
      expect(screen.getByTestId("pane-rel-4")).toHaveTextContent("v4");
    });

    it("labels each release option with its status in words", () => {
      render(<PlaygroundTab />);

      expect(
        within(screen.getByLabelText("Release A")).getByText("v3 · Live (GA)"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByLabelText("Release A")).getByText("v4 · Draft"),
      ).toBeInTheDocument();
    });

    it("does not let one release be compared with itself", () => {
      render(<PlaygroundTab />);

      fireEvent.change(screen.getByLabelText("Release A"), { target: { value: "rel-4" } });

      expect(screen.getByLabelText("Release B")).toHaveValue("");
      expect(screen.queryByTestId("pane-rel-3")).not.toBeInTheDocument();
    });

    it("says what is missing instead of leaving Send mysteriously disabled", () => {
      render(<PlaygroundTab />);
      expect(screen.getByTestId("playground-blocked")).toHaveTextContent("Choose a course first.");

      pickCourse();
      expect(screen.getByTestId("playground-blocked")).toHaveTextContent(
        "Write a message or choose a card action.",
      );

      say("hello");
      expect(screen.queryByTestId("playground-blocked")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send to both" })).toBeEnabled();
    });

    it("refuses an items-completed figure out of range", () => {
      render(<PlaygroundTab />);
      pickCourse();
      say("hello");

      fireEvent.change(screen.getByLabelText("Items completed"), { target: { value: "900" } });

      expect(screen.getByTestId("playground-blocked")).toHaveTextContent(
        "Fix the number of items completed.",
      );
      expect(screen.getByRole("alert")).toHaveTextContent("0 to 500");
    });

    it("offers no safety mode of Crisis: the monitor decides that", () => {
      render(<PlaygroundTab />);

      const options = within(screen.getByLabelText("Safety mode")).getAllByRole("option");
      expect(options.map(option => option.textContent)).toEqual([
        "Normal",
        "Care",
        "Crisis follow-up",
      ]);
    });
  });

  describe("running", () => {
    it("sends the same line to both releases with the scenario, each with its own empty history", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      fireEvent.change(screen.getByLabelText("Safety mode"), { target: { value: "CARE" } });
      fireEvent.change(screen.getByLabelText("Items completed"), { target: { value: "4" } });
      say("I feel stuck");

      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
      const bodies = h.run.mock.calls.map(call => call[0]);
      expect(bodies.map(body => body.releaseId).sort()).toEqual(["rel-3", "rel-4"]);
      for (const body of bodies) {
        expect(body).toMatchObject({
          trackId: "t-1",
          message: "I feel stuck",
          mode: "CARE",
          progress: 4,
          guidance: "walk",
          channel: "text",
          history: [],
        });
      }
    });

    it("shows each release's reply in its own column, with the numbers, situation report and safety verdict", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      say("hello");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      const v3 = await screen.findByTestId("pane-rel-3");
      await waitFor(() => expect(within(v3).getByTestId("pane-reply")).toBeInTheDocument());
      expect(within(v3).getByTestId("pane-reply")).toHaveTextContent("Reply from v3");
      expect(within(screen.getByTestId("pane-rel-4")).getByTestId("pane-reply")).toHaveTextContent(
        "Reply from v4",
      );
      expect(v3).toHaveTextContent("claude-sonnet-5-5");
      expect(v3).toHaveTextContent("6.20 s");
      expect(v3).toHaveTextContent("$0.0123");
      expect(v3).toHaveTextContent("100 in, 20 out, 50 from cache");
      expect(within(v3).getByTestId("pane-situation")).toHaveTextContent("Turn 1 situation for v3");
      expect(within(v3).getByTestId("pane-sentinel")).toHaveTextContent("Risk: none");
    });

    it("marks a dry-run tool call as one, and shows its input and result", async () => {
      h.run.mockImplementation((body: { releaseId: string }) => ({
        unwrap: () =>
          Promise.resolve(
            answer(3, `Reply from ${body.releaseId}`, {
              toolCalls: [
                {
                  name: "show_card",
                  input: { kind: "practice" },
                  result: "Would have shown the practice card.",
                  isError: false,
                  simulated: true,
                },
                { name: "lookup", input: {}, result: "boom", isError: true, simulated: false },
              ],
            }),
          ),
        abort: vi.fn(),
      }));
      render(<PlaygroundTab />);
      pickCourse();
      say("hello");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      const tools = await within(await screen.findByTestId("pane-rel-3")).findAllByTestId(
        "pane-tool",
      );

      expect(tools[0]).toHaveTextContent("show_card");
      expect(tools[0]).toHaveTextContent("Dry run");
      expect(tools[0]).toHaveTextContent("Would have shown the practice card.");
      expect(tools[0]).toHaveTextContent('"kind": "practice"');
      expect(tools[1]).not.toHaveTextContent("Dry run");
      expect(tools[1]).toHaveTextContent("failed");
    });

    it("says when no tools were called", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      say("hello");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      expect(
        await within(await screen.findByTestId("pane-rel-3")).findByText("No tools were called."),
      ).toBeInTheDocument();
    });

    it("says the model was not asked when the safety monitor sent the fixed crisis copy", async () => {
      h.run.mockImplementation(() => ({
        unwrap: () => Promise.resolve(answer(3, "Please call...", { replyKind: "crisis" })),
        abort: vi.fn(),
      }));
      render(<PlaygroundTab />);
      pickCourse();
      say("I want to end it");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      const pane = await screen.findByTestId("pane-rel-3");
      await waitFor(() => expect(pane).toHaveTextContent("Fixed crisis copy"));
      expect(pane).toHaveTextContent("the model was not asked");
    });

    it("shows progress while a run is in flight and locks Send until it finishes", async () => {
      const finishers: ((value: unknown) => void)[] = [];
      h.run.mockImplementation(() => ({
        unwrap: () => new Promise(resolve => finishers.push(resolve)),
        abort: vi.fn(),
      }));
      render(<PlaygroundTab />);
      pickCourse();
      say("hello");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      const running = await screen.findAllByTestId("pane-running");
      expect(running[0]).toHaveTextContent("5 to 30 seconds");
      expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
      expect(screen.getByTestId("playground-blocked")).toHaveTextContent(
        "Wait for the current run to finish.",
      );

      finishers.forEach(finish => finish(answer(3, "done")));
      await waitFor(() => expect(screen.queryByTestId("pane-running")).not.toBeInTheDocument());
    });

    it("clears the message once sent, ready for the next line", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      say("hello");

      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      await waitFor(() => expect(screen.getByLabelText("What the learner says")).toHaveValue(""));
    });
  });

  describe("continuing the conversation", () => {
    it("sends each release its own earlier replies, with the same new learner line", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      say("first");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));
      await waitFor(() => expect(screen.getAllByTestId("pane-reply")).toHaveLength(2));
      h.run.mockClear();

      say("second");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
      const byRelease = Object.fromEntries(
        h.run.mock.calls.map(call => [call[0].releaseId, call[0]]),
      );
      expect(byRelease["rel-3"].message).toBe("second");
      expect(byRelease["rel-4"].message).toBe("second");
      expect(byRelease["rel-3"].history).toEqual([
        { role: "learner", text: "first" },
        { role: "ally", text: "Reply from v3" },
      ]);
      expect(byRelease["rel-4"].history).toEqual([
        { role: "learner", text: "first" },
        { role: "ally", text: "Reply from v4" },
      ]);
    });

    it("starts over when asked, clearing both columns and keeping the scenario", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      say("first");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));
      await waitFor(() => expect(screen.getAllByTestId("pane-reply")).toHaveLength(2));

      fireEvent.click(screen.getByRole("button", { name: "Start over" }));

      expect(screen.queryByTestId("pane-reply")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Choose a course")).toHaveValue("t-1");
    });
  });

  describe("variations", () => {
    it("sends a card action alone, leaving the message empty", async () => {
      render(<PlaygroundTab />);
      pickCourse();

      fireEvent.change(screen.getByLabelText("Card action (optional)"), {
        target: { value: "start" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
      expect(h.run.mock.calls[0][0]).toMatchObject({ message: "", intent: "start" });
      expect((await screen.findAllByTestId("pane-learner-line"))[0]).toHaveTextContent(
        "Action: Pressed Start",
      );
    });

    it("runs a visitor without progress or an organisation layer", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      fireEvent.change(screen.getByLabelText("Organisation layer"), { target: { value: "org-1" } });
      fireEvent.click(screen.getByLabelText("Run as an anonymous visitor"));
      say("hi");

      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      await waitFor(() => expect(h.run).toHaveBeenCalled());
      const body = h.run.mock.calls[0][0];
      expect(body.visitor).toBe(true);
      expect(body).not.toHaveProperty("progress");
      expect(body).not.toHaveProperty("tenantId");
      expect(screen.getByLabelText("Items completed")).toBeDisabled();
    });

    it("sends the organisation layer when one is chosen", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      fireEvent.change(screen.getByLabelText("Organisation layer"), { target: { value: "org-1" } });
      say("hi");

      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      await waitFor(() => expect(h.run).toHaveBeenCalled());
      expect(h.run.mock.calls[0][0].tenantId).toBe("org-1");
    });

    it("runs a single release when no second one is chosen", async () => {
      render(<PlaygroundTab />);
      pickCourse();
      fireEvent.change(screen.getByLabelText("Release B"), { target: { value: "" } });
      say("hi");

      fireEvent.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId("pane-rel-4")).not.toBeInTheDocument();
    });
  });

  describe("failure and stopping", () => {
    it("shows one release's failure in its own column, with a retry, while the other answers", async () => {
      h.run.mockImplementation((body: { releaseId: string }) =>
        body.releaseId === "rel-4"
          ? {
              unwrap: () => Promise.reject({ status: 400, data: { message: "Release not found" } }),
              abort: vi.fn(),
            }
          : respond(body),
      );
      render(<PlaygroundTab />);
      pickCourse();
      say("hi");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      const failed = await screen.findByTestId("pane-error");
      expect(failed).toHaveTextContent("This run failed. Release not found");
      expect(within(screen.getByTestId("pane-rel-3")).getByTestId("pane-reply")).toHaveTextContent(
        "Reply from v3",
      );

      h.run.mockClear();
      h.run.mockImplementation(respond);
      fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
      expect(h.run.mock.calls[0][0]).toMatchObject({ releaseId: "rel-4", message: "hi" });
      await waitFor(() =>
        expect(
          within(screen.getByTestId("pane-rel-4")).getByTestId("pane-reply"),
        ).toHaveTextContent("Reply from v4"),
      );
    });

    it("lets you stop waiting, aborts the request, and says the server may still finish", async () => {
      const aborts: ReturnType<typeof vi.fn>[] = [];
      h.run.mockImplementation(() => {
        const abort = vi.fn();
        aborts.push(abort);
        return {
          unwrap: () =>
            new Promise((_resolve, reject) =>
              abort.mockImplementation(() => reject({ name: "AbortError" })),
            ),
          abort,
        };
      });
      render(<PlaygroundTab />);
      pickCourse();
      say("hi");
      fireEvent.click(screen.getByRole("button", { name: "Send to both" }));

      const [first] = await screen.findAllByRole("button", { name: "Stop waiting" });
      fireEvent.click(first);

      expect(aborts.filter(abort => abort.mock.calls.length > 0)).toHaveLength(1);
      expect(await screen.findByTestId("pane-error")).toHaveTextContent(
        "Stopped waiting. The server may still finish this run",
      );
      // The other column is still running.
      expect(screen.getAllByTestId("pane-running")).toHaveLength(1);
    });
  });
});
