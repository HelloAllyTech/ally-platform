import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderEvalSuiteDetail } from "@types";

import {
  evalRun,
  evalSuite,
  evalSuiteDetail,
  gatesWith,
  interviewFixture,
  reviewFixture,
} from "./evalTestData";

vi.mock("@components", () => ({ cellTypes: {} }));

let suiteResult: {
  data?: BuilderEvalSuiteDetail;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};
let lastArgs: { id: unknown; options: any };
const refetch = vi.fn();

const cancelSuite = vi.fn();
vi.mock("@api", () => ({
  useGetBuilderEvalSuiteQuery: (id: unknown, options: unknown) => {
    lastArgs = { id, options };
    return suiteResult;
  },
  useCancelBuilderEvalSuiteMutation: () => [cancelSuite],
}));

// eslint-disable-next-line import/first
import { en } from "@constants";

// eslint-disable-next-line import/first
import { SuiteDetailPanel } from "../eval/SuiteDetailPanel";

const strings = en.builder.eval;
const fixtures = [interviewFixture(), reviewFixture()];

const renderPanel = (overrides: Partial<React.ComponentProps<typeof SuiteDetailPanel>> = {}) =>
  render(
    <SuiteDetailPanel
      suiteId="suite-1"
      fixtures={fixtures}
      onClose={vi.fn()}
      onOpenSuite={vi.fn()}
      {...overrides}
    />,
  );

beforeEach(() => {
  suiteResult = { data: evalSuiteDetail(), isLoading: false, isError: false, refetch };
  refetch.mockReset();
});

describe("SuiteDetailPanel", () => {
  it("renders nothing until a suite is chosen, and does not fetch", () => {
    const { container } = renderPanel({ suiteId: null });

    expect(container).toBeEmptyDOMElement();
    expect(lastArgs.options.skip).toBe(true);
  });

  it("shows the suite's totals", () => {
    renderPanel();

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("4 of 6")).toBeInTheDocument();
    expect(within(panel).getByText("0.50")).toBeInTheDocument();
    expect(within(panel).getByText("~$12.00")).toBeInTheDocument();
  });

  it("groups runs under their fixture and says how many passed", () => {
    suiteResult.data = evalSuiteDetail({
      runs: [
        evalRun({ id: "r1", fixtureId: "fix-1", repetition: 1 }),
        evalRun({ id: "r2", fixtureId: "fix-1", repetition: 2, status: "passed", gates: null }),
        evalRun({ id: "r3", fixtureId: "fix-2", repetition: 1, status: "passed", gates: null }),
      ],
    });
    renderPanel();

    expect(screen.getByText("Digest email")).toBeInTheDocument();
    expect(screen.getByText("Clean control")).toBeInTheDocument();
    expect(screen.getByText(strings.suiteDetail.fixturePassed(1, 2))).toBeInTheDocument();
    expect(screen.getByText(strings.suiteDetail.fixturePassed(1, 1))).toBeInTheDocument();
  });

  describe("a run", () => {
    it("shows which gates failed without opening it, and not the ones that held", () => {
      renderPanel();

      const card = screen.getByText(strings.runCard.run(1)).closest("li") as HTMLElement;
      expect(
        within(card).getByText(strings.runCard.gateFailing(strings.gates.unseenFailures.label, 2)),
      ).toBeInTheDocument();
      expect(
        within(card).getByText(
          strings.runCard.gateFailing(strings.gates.evidenceCited.label, null),
        ),
      ).toBeInTheDocument();
      expect(within(card).queryByText(strings.gates.consistent.label)).not.toBeInTheDocument();
      expect(
        within(card).queryByText(strings.gates.askedBeforeReading.label),
      ).not.toBeInTheDocument();
    });

    it("says every gate was clean when none failed", () => {
      suiteResult.data = evalSuiteDetail({
        runs: [evalRun({ status: "passed", gates: gatesWith() })],
      });
      renderPanel();

      expect(screen.getByText(strings.runCard.gatesClean)).toBeInTheDocument();
    });

    it("keeps its detail folded until asked", () => {
      renderPanel();

      expect(screen.queryByText(strings.runCard.metricsHeading)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      expect(screen.getByText(strings.runCard.metricsHeading)).toBeInTheDocument();
      // Two unseen failures, and evidence not cited (a false flag counts as one).
      expect(screen.getByText(strings.runCard.gatesHeading(3))).toBeInTheDocument();
    });

    it("lists all six gates once opened, flagging the failing ones", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      for (const key of [
        "unseenFailures",
        "askedBeforeReading",
        "unrepairedEditFailures",
        "falseUpdateClaims",
        "consistent",
        "evidenceCited",
      ] as const) {
        expect(
          screen.getAllByText(strings.gates[key].label, { exact: false }).length,
        ).toBeGreaterThan(0);
      }
      expect(screen.getByText(strings.runCard.gatesHeading(3))).toBeInTheDocument();
    });

    it("shows the judge's verdict per checklist item, with the item's text and its evidence", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      expect(screen.getByText(strings.runCard.judgeHeading(1, 2, "0.50"))).toBeInTheDocument();

      const unmet = screen.getByText("The PRD plans a fresh digest scheduler.").closest("li");
      expect(within(unmet as HTMLElement).getByText(strings.runCard.unmet)).toBeInTheDocument();
      expect(
        within(unmet as HTMLElement).getByText("Reuses the existing digest job"),
      ).toBeInTheDocument();

      const met = screen.getByText("No new table is mentioned.").closest("li");
      expect(within(met as HTMLElement).getByText(strings.runCard.met)).toBeInTheDocument();
    });

    it("shows the metrics and what the simulated admin corrected", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      expect(screen.getByText(strings.runCard.readyYes(88))).toBeInTheDocument();
      expect(screen.getByText(strings.runCard.toolCalls(14, 3))).toBeInTheDocument();
      expect(screen.getByText(strings.runCard.correctedItems("C1"))).toBeInTheDocument();
    });

    it("shows the critic's outcome for a PRD-review run", () => {
      suiteResult.data = evalSuiteDetail({
        runs: [
          evalRun({
            fixtureId: "fix-2",
            gates: null,
            metrics: null,
            judge: null,
            critic: {
              asExpected: false,
              blockingRows: ["testPlanRepos"],
              findings: [
                { id: "F1", category: "scope", detail: "The plan touches a second repo." },
              ],
            },
          }),
        ],
      });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      expect(screen.getByText(strings.runCard.criticNotAsExpected)).toBeInTheDocument();
      expect(
        screen.getByText(strings.runCard.criticBlockedOn("testPlanRepos")),
      ).toBeInTheDocument();
      expect(
        screen.getByText("The plan touches a second repo.", { exact: false }),
      ).toBeInTheDocument();
    });

    it("leaves the interview-only parts off a PRD-review run, and says what the critic did in its header", () => {
      suiteResult.data = evalSuiteDetail({
        runs: [
          evalRun({
            fixtureId: "fix-2",
            status: "failed",
            gates: null,
            judge: null,
            transcript: null,
            metrics: {
              turns: 0,
              questions: 0,
              corrections: 0,
              correctedItems: [],
              readyReached: false,
              readinessScore: 100,
              toolCalls: 0,
              toolFailures: 0,
              costUsd: 0.01,
              durationMs: 37_000,
            },
            critic: { asExpected: false, blockingRows: ["prdReview"], findings: [] },
          }),
        ],
      });
      renderPanel();

      const card = screen.getByText(strings.runCard.run(1)).closest("li") as HTMLElement;
      expect(within(card).getByText(strings.runCard.criticShortNotAsExpected)).toBeInTheDocument();
      // No "0 turns · 0 corrections" for a run that never had an interview.
      expect(within(card).queryByText(/turns/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));
      expect(screen.getByText(strings.runCard.criticHeading)).toBeInTheDocument();
      expect(screen.queryByText(strings.runCard.metricsHeading)).not.toBeInTheDocument();
      expect(screen.queryByText(strings.runCard.transcriptHeading)).not.toBeInTheDocument();
      expect(screen.queryByText(strings.transcript.none)).not.toBeInTheDocument();
    });

    it("has an expandable transcript inside the run", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      expect(screen.queryByText("Let me look at what exists.")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: strings.transcript.show(1) }));
      expect(screen.getByText("Let me look at what exists.")).toBeInTheDocument();
      const failedCall = screen.getByText("update_prd").closest("li") as HTMLElement;
      expect(within(failedCall).getByText(strings.transcript.failed)).toBeInTheDocument();
    });

    it("shows a run's error", () => {
      suiteResult.data = evalSuiteDetail({
        runs: [
          evalRun({
            status: "errored",
            gates: null,
            metrics: null,
            judge: null,
            transcript: null,
            error: "The interview loop threw",
          }),
        ],
      });
      renderPanel();

      expect(
        screen.getByText(strings.runCard.error("The interview loop threw")),
      ).toBeInTheDocument();
    });

    it("survives a judge or critic an agent wrote badly", () => {
      suiteResult.data = evalSuiteDetail({
        runs: [
          evalRun({
            judge: { met: 0, total: 0, score: 1, items: "none" as never },
            critic: { asExpected: true, blockingRows: "x" as never, findings: null as never },
          }),
        ],
      });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: strings.runCard.showDetails }));

      expect(screen.getByText(strings.runCard.judgeNone)).toBeInTheDocument();
      expect(screen.getByText(strings.runCard.criticDidNotBlock)).toBeInTheDocument();
    });
  });

  describe("a prompt gate", () => {
    const gate = (overrides: Partial<BuilderEvalSuiteDetail>) =>
      evalSuiteDetail({
        trigger: "prompt_gate",
        candidate: {
          promptCode: "builder_interviewer_system",
          content: "x".repeat(1200),
          model: "claude-sonnet-5",
          provider: "anthropic",
          temperature: 0.3,
        },
        ...overrides,
      });

    it("shows what was proposed", () => {
      suiteResult.data = gate({});
      renderPanel();

      expect(screen.getByText("builder_interviewer_system")).toBeInTheDocument();
      expect(screen.getByText(strings.suiteDetail.candidateText(1200))).toBeInTheDocument();
      expect(
        screen.getByText(strings.suiteDetail.candidateModel("claude-sonnet-5", "anthropic")),
      ).toBeInTheDocument();
      expect(screen.getByText(strings.suiteDetail.candidateTemperature(0.3))).toBeInTheDocument();
    });

    it("shows a pass that was published, with the reasons", () => {
      suiteResult.data = gate({
        verdict: {
          pass: true,
          reasons: ["Gate violations 3 (baseline 5).", "Corrections 2 (baseline 2)."],
          baselineSuiteId: "base-1",
        },
        publishedAt: "2026-10-20T10:00:00.000Z",
      });
      renderPanel();

      const verdict = screen.getByText(strings.suiteDetail.verdictHeading).closest("section");
      expect(
        within(verdict as HTMLElement).getByText(strings.suiteDetail.verdictPass),
      ).toBeInTheDocument();
      expect(
        within(verdict as HTMLElement).getByText("Gate violations 3 (baseline 5)."),
      ).toBeInTheDocument();
      expect(within(verdict as HTMLElement).getByText(/^Published /)).toBeInTheDocument();
    });

    it("shows a failure as not published", () => {
      suiteResult.data = gate({
        verdict: {
          pass: false,
          reasons: ["Gate violations rose from 3 to 5."],
          baselineSuiteId: null,
        },
      });
      renderPanel();

      const verdict = screen.getByText(strings.suiteDetail.verdictHeading).closest("section");
      expect(
        within(verdict as HTMLElement).getByText(strings.suiteDetail.verdictFail),
      ).toBeInTheDocument();
      expect(
        within(verdict as HTMLElement).getByText(strings.suiteDetail.notPublished),
      ).toBeInTheDocument();
      expect(
        within(verdict as HTMLElement).getByText("Gate violations rose from 3 to 5."),
      ).toBeInTheDocument();
    });

    it("opens the baseline it was compared with", () => {
      suiteResult.data = gate({
        verdict: { pass: true, reasons: [], baselineSuiteId: "base-1" },
      });
      const onOpenSuite = vi.fn();
      renderPanel({ onOpenSuite });

      fireEvent.click(screen.getByRole("button", { name: strings.suiteDetail.openBaseline }));
      expect(onOpenSuite).toHaveBeenCalledWith("base-1");
    });

    it("says the verdict is pending while it runs", () => {
      suiteResult.data = gate({ status: "running", summary: null, verdict: null, runs: [] });
      renderPanel();

      expect(screen.getByText(strings.suiteDetail.verdictPending)).toBeInTheDocument();
    });
  });

  describe("a suite still running", () => {
    beforeEach(() => {
      suiteResult.data = evalSuiteDetail({
        status: "running",
        summary: null,
        // Every run exists from the start, queued; only the finished ones are progress.
        runs: [
          evalRun({ id: "r1", status: "passed", repetition: 1 }),
          evalRun({ id: "r2", status: "failed", repetition: 2 }),
          evalRun({ id: "r3", status: "running", repetition: 3, gates: null, metrics: null }),
          evalRun({ id: "r4", status: "queued", repetition: 4, gates: null, metrics: null }),
        ],
      });
    });

    it("says how many runs have finished, and refreshes itself", () => {
      renderPanel();

      expect(screen.getByText(strings.suiteDetail.running(2, 6))).toBeInTheDocument();
      expect(lastArgs.options.pollingInterval).toBe(10_000);
    });

    it("stops polling once the suite has settled", () => {
      suiteResult.data = evalSuiteDetail();
      renderPanel();

      expect(lastArgs.options.pollingInterval).toBe(0);
    });
  });

  it("shows a suite's own error", () => {
    suiteResult.data = evalSuiteDetail({ status: "errored", error: "Cut off by a restart" });
    renderPanel();

    expect(screen.getByText(strings.suiteDetail.errored)).toBeInTheDocument();
    expect(screen.getByText("Cut off by a restart")).toBeInTheDocument();
  });

  it("names a fixture that has since been deleted, instead of leaving a blank heading", () => {
    suiteResult.data = evalSuiteDetail({
      summary: { ...evalSuite().summary!, fixtures: [] },
      runs: [evalRun({ fixtureId: "gone" })],
    });
    renderPanel({ fixtures: [] });

    expect(screen.getByText(strings.suiteDetail.deletedFixture)).toBeInTheDocument();
  });

  it("offers a retry when the suite will not load", () => {
    suiteResult = { data: undefined, isLoading: false, isError: true, refetch };
    renderPanel();

    expect(screen.getByText(strings.suiteDetail.loadFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: strings.suiteDetail.retry }));
    expect(refetch).toHaveBeenCalled();
  });

  describe("cancelling", () => {
    it("asks before stopping a running suite, then cancels it", async () => {
      cancelSuite.mockReturnValue({ unwrap: () => Promise.resolve({}) });
      suiteResult = {
        ...suiteResult,
        data: evalSuiteDetail({ status: "running" } as Partial<BuilderEvalSuiteDetail>),
      };
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: strings.suiteDetail.cancel }));
      expect(screen.getByText(strings.suiteDetail.cancelAsk)).toBeInTheDocument();
      expect(cancelSuite).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: strings.suiteDetail.cancelConfirm }));
      await vi.waitFor(() => expect(cancelSuite).toHaveBeenCalledWith("suite-1"));
    });

    it("offers no cancel for a suite that has finished", () => {
      suiteResult = {
        ...suiteResult,
        data: evalSuiteDetail({ status: "completed" } as Partial<BuilderEvalSuiteDetail>),
      };
      renderPanel();

      expect(
        screen.queryByRole("button", { name: strings.suiteDetail.cancel }),
      ).not.toBeInTheDocument();
    });

    it("says a cancelled suite was cancelled, not that it errored", () => {
      suiteResult = {
        ...suiteResult,
        data: evalSuiteDetail({
          status: "cancelled",
          error: "Cancelled by admin 7.",
        } as Partial<BuilderEvalSuiteDetail>),
      };
      renderPanel();

      expect(screen.getByText(strings.suiteDetail.cancelledTitle)).toBeInTheDocument();
      expect(screen.queryByText(strings.suiteDetail.errored)).not.toBeInTheDocument();
    });
  });
});
