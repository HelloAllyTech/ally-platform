import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  runs: vi.fn(),
  run: vi.fn(),
  outputs: vi.fn(),
  cases: vi.fn(),
  releases: vi.fn(),
  access: { current: { canReadTranscripts: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideEvalRunsQuery: (_arg: unknown, options: unknown) => h.runs(options),
  useGetAllyGuideEvalRunQuery: (id: string) => h.run(id),
  useGetAllyGuideEvalRunOutputsQuery: (id: string, options?: { skip?: boolean }) =>
    options?.skip ? { data: undefined } : h.outputs(id),
  useGetAllyGuideEvalCasesQuery: () => h.cases(),
  useGetAllyGuideReleasesQuery: () => h.releases(),
}));

// eslint-disable-next-line import/first
import { EvalRunsPanel } from "../EvalRunsPanel";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const run = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  releaseId: "rel-4",
  baselineReleaseId: "rel-3",
  kind: "gate",
  status: "passed",
  repetitions: 3,
  caseCount: 40,
  summary: {},
  costUsd: "1.2000",
  triggeredBy: 5,
  startedAt: "2026-10-23T09:00:00.000Z",
  completedAt: "2026-10-23T09:20:00.000Z",
  createdAt: "2026-10-23T08:59:00.000Z",
  ...overrides,
});

const DECISION = {
  passed: false,
  reasons: ["2 safety cases failed", "Quality fell against the live release"],
  safetyFailures: 2,
  safetyFailedCases: ["c-1"],
  quality: {
    candidateCasesPassed: 30,
    baselineCasesPassed: 36,
    qualityCases: 40,
    candidateMean: 0.8,
    baselineMean: 0.9,
  },
  target: { cases: 3, candidate: 1, baseline: 0 },
  guard: { status: "pending", reason: "Too few guided learners yet." },
};

const result = (
  id: string,
  caseId: string,
  passed: boolean,
  extra: Record<string, unknown> = {},
) => ({
  id,
  caseId,
  releaseId: "rel-4",
  repetition: Number(id.slice(-1)),
  passed,
  safetyFailed: false,
  quality: 0.8,
  failedChecks: passed ? [] : [{ id: "no_prompt_leak", severity: "safety" }],
  error: null,
  latencyMs: 4000,
  costUsd: 0.01,
  ...extra,
});

const DETAIL = {
  run: run({ summary: { decision: DECISION } }),
  results: [
    result("res-1", "c-1", true),
    result("res-2", "c-1", false),
    result("res-3", "c-2", false, { error: "model timed out", safetyFailed: true }),
  ],
};

const openRun = () =>
  fireEvent.click(screen.getByRole("button", { name: /Open the Gate run of v4/ }));

describe("EvalRunsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canReadTranscripts: true };
    h.runs.mockReturnValue(ok([run()]));
    h.run.mockReturnValue(ok(DETAIL));
    h.outputs.mockReturnValue(
      ok([
        { ...result("res-1", "c-1", true), output: { reply: "Reply one" } },
        { ...result("res-2", "c-1", false), output: { reply: "Reply two" } },
      ]),
    );
    h.cases.mockReturnValue(
      ok([
        { id: "c-1", title: "Mentions the hotline too early" },
        { id: "c-2", title: "Quiz answer extraction" },
      ]),
    );
    h.releases.mockReturnValue(
      ok([
        { id: "rel-4", version: 4, status: "draft" },
        { id: "rel-3", version: 3, status: "ga" },
      ]),
    );
  });

  describe("the list", () => {
    it("shows each run with its release, kind, status in words, size and cost", () => {
      render(<EvalRunsPanel />);

      const row = screen.getByTestId("eval-run-row");
      expect(row).toHaveTextContent("v4");
      expect(row).toHaveTextContent("Gate");
      expect(row).toHaveTextContent("Passed");
      expect(row).toHaveTextContent("40 cases × 3");
      expect(row).toHaveTextContent("$1.20");
    });

    it("does not poll when nothing is going, and polls while a run is queued or running", () => {
      render(<EvalRunsPanel />);
      expect(h.runs.mock.calls.at(-1)?.[0]).toMatchObject({ pollingInterval: 0 });
      expect(screen.queryByTestId("runs-refreshing")).not.toBeInTheDocument();

      h.runs.mockReturnValue(ok([run({ status: "running", caseCount: 10, repetitions: 1 })]));
      const { rerender } = render(<EvalRunsPanel />);
      rerender(<EvalRunsPanel />);
      expect(h.runs.mock.calls.at(-1)?.[0]).toMatchObject({ pollingInterval: 5000 });
      expect(screen.getAllByTestId("runs-refreshing").length).toBeGreaterThan(0);
    });

    it("says there are no runs yet and where to start one", () => {
      h.runs.mockReturnValue(ok([]));
      render(<EvalRunsPanel />);

      expect(screen.getByText("No eval runs yet")).toBeInTheDocument();
      expect(screen.getByText(/Start one from a release's page/)).toBeInTheDocument();
    });

    it("tells a failed load from an empty one, with a retry", () => {
      const refetch = vi.fn();
      h.runs.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<EvalRunsPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("falls back to a dash for a release the list does not know", () => {
      h.releases.mockReturnValue(ok([]));
      render(<EvalRunsPanel />);

      expect(screen.getByTestId("eval-run-row")).toHaveTextContent("—");
    });
  });

  describe("one run", () => {
    it("says whether the gate passed and why, in the server's own reasons", () => {
      render(<EvalRunsPanel />);
      openRun();

      expect(screen.getByTestId("run-decision")).toHaveTextContent("The gate failed.");
      expect(screen.getByTestId("run-reasons")).toHaveTextContent("2 safety cases failed");
      const detail = screen.getByTestId("eval-run-detail");
      expect(detail).toHaveTextContent("2 safety cases failed.");
      expect(detail).toHaveTextContent("30 of 40 cases passed, against 36 on the live release");
      expect(detail).toHaveTextContent("1 of 3 now pass, against 0 before");
      expect(screen.getByTestId("run-guard")).toHaveTextContent("waiting for enough learners");
    });

    it("says there is no decision yet for a run still going", () => {
      h.run.mockReturnValue(ok({ run: run({ status: "running", summary: {} }), results: [] }));
      render(<EvalRunsPanel />);
      openRun();

      expect(screen.getByText("No decision yet.")).toBeInTheDocument();
    });

    it("groups results by case with the repetitions that passed, the failed checks and any error", () => {
      render(<EvalRunsPanel />);
      openRun();

      const [first, second] = screen.getAllByTestId("run-result-row");
      expect(first).toHaveTextContent("Mentions the hotline too early");
      expect(first).toHaveTextContent("1 of 2");
      expect(first).toHaveTextContent("no_prompt_leak");
      expect(second).toHaveTextContent("Quiz answer extraction");
      expect(second).toHaveTextContent("Error: model timed out");
      expect(second).toHaveTextContent("Safety");
    });

    it("names an unknown case rather than leaving a blank", () => {
      h.cases.mockReturnValue(ok([]));
      render(<EvalRunsPanel />);
      openRun();

      expect(screen.getAllByTestId("run-result-row")[0]).toHaveTextContent("A case");
    });

    it("shows no replayed reply until asked, and then shows each repetition's", () => {
      render(<EvalRunsPanel />);
      openRun();
      expect(h.outputs).not.toHaveBeenCalled();
      expect(screen.getByTestId("eval-run-detail")).not.toHaveTextContent("Reply one");

      fireEvent.click(screen.getByRole("button", { name: "Show the replies" }));

      expect(h.outputs).toHaveBeenCalledWith("run-1");
      const row = screen.getAllByTestId("run-result-row")[0];
      expect(row).toHaveTextContent("Repetition 1: Reply one");
      expect(row).toHaveTextContent("Repetition 2: Reply two");
    });

    it("offers no replies without the transcripts permission, and says why", () => {
      h.access.current = { canReadTranscripts: false };
      render(<EvalRunsPanel />);
      openRun();

      expect(screen.queryByRole("button", { name: "Show the replies" })).not.toBeInTheDocument();
      expect(screen.getByText(/needs the transcripts permission/)).toBeInTheDocument();
      expect(h.outputs).not.toHaveBeenCalled();
    });

    it("polls the run while it is running", () => {
      h.run.mockReturnValue(ok({ run: run({ status: "running", summary: {} }), results: [] }));
      render(<EvalRunsPanel />);
      openRun();

      expect(
        within(screen.getByTestId("eval-run-detail")).getByText("No decision yet."),
      ).toBeInTheDocument();
    });

    it("shows a skeleton while loading, and a failure with a retry", () => {
      h.run.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      const { unmount } = render(<EvalRunsPanel />);
      openRun();
      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      unmount();

      const refetch = vi.fn();
      h.run.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<EvalRunsPanel />);
      openRun();
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" }),
      );
      expect(refetch).toHaveBeenCalled();
    });
  });
});
