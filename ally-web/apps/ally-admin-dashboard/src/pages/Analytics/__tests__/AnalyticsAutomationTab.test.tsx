import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveMock = vi.fn();
const rejectMock = vi.fn();
let runs: AnalyticsAutomationRunSummary[] = [];
let details: Record<string, AnalyticsAutomationRunDetail> = {};

// Partial mock: the store wires every other slice off `@api`, so only the hooks
// this tab calls are stubbed.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetAnalyticsAutomationRunsQuery: () => ({ data: runs, isLoading: false, isError: false }),
  useGetAnalyticsAutomationRunQuery: (id: string, options?: { skip?: boolean }) => ({
    data: options?.skip ? undefined : details[id],
    isError: false,
  }),
  useGetAnalyticsAutomationConfigQuery: () => ({ data: { manualStartEnabled: false } }),
  useStartAnalyticsAutomationRunMutation: () => [vi.fn(), { isLoading: false }],
  useApproveAnalyticsAutomationAgentMutation: () => [approveMock, { isLoading: false }],
  useRejectAnalyticsAutomationAgentMutation: () => [rejectMock, { isLoading: false }],
}));

import { en } from "@constants";
import type {
  AnalyticsAutomationAgentRun,
  AnalyticsAutomationRunDetail,
  AnalyticsAutomationRunSummary,
} from "@types";

import { AnalyticsAutomationTab } from "../tabs/AnalyticsAutomationTab";

const strings = en.analyticsAutomation;

const agent = (overrides: Partial<AnalyticsAutomationAgentRun>): AnalyticsAutomationAgentRun => ({
  id: "a",
  agent: "backend_review",
  status: "completed",
  startedAt: null,
  finishedAt: null,
  summary: null,
  note: null,
  output: {},
  pullRequest: null,
  review: null,
  decision: null,
  decidedAt: null,
  canApprove: false,
  canReject: false,
  findings: [],
  ...overrides,
});

const run = (agentRuns: AnalyticsAutomationAgentRun[]): AnalyticsAutomationRunDetail => ({
  id: "run-1",
  ranAt: "2026-11-09T02:00:00.000Z",
  finishedAt: "2026-11-09T02:10:00.000Z",
  status: "completed",
  agents: agentRuns.map(a => ({ agent: a.agent, status: a.status })),
  commitShas: {
    platform: { base: null, head: "abcdef1234567", since: "2026-11-02T00:00:00.000Z" },
    dbt: { head: "1234567abcdef" },
  },
  agentRuns,
});

const open = (detail: AnalyticsAutomationRunDetail) => {
  runs = [detail];
  details = { [detail.id]: detail };
};

describe("AnalyticsAutomationTab", () => {
  beforeEach(() => {
    approveMock.mockReset();
    rejectMock.mockReset();
    runs = [];
    details = {};
  });

  it("says when no run exists yet, and offers no way to start one", () => {
    render(<AnalyticsAutomationTab />);
    expect(screen.getByText(strings.historyEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start|run now/i })).not.toBeInTheDocument();
  });

  it("opens the newest run and shows all three agents", () => {
    open(
      run([
        agent({ id: "1", agent: "backend_review", summary: "Auth **changed**." }),
        agent({ id: "2", agent: "posthog_events", summary: "No pull request opened." }),
        agent({ id: "3", agent: "dbt_metrics", status: "waiting", note: "Waiting for the PostHog events pull request to be merged or closed." }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    expect(screen.getByText(strings.agentBackendReview)).toBeInTheDocument();
    expect(screen.getByText(strings.agentPosthog)).toBeInTheDocument();
    expect(screen.getByText(strings.agentDbt)).toBeInTheDocument();
    expect(screen.getByText("changed")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the PostHog events pull request/)).toBeInTheDocument();
    // Nothing to approve while it waits.
    expect(screen.queryByRole("button", { name: strings.approve })).not.toBeInTheDocument();
  });

  it("shows the PostHog pull request with its state and the review verdict", () => {
    open(
      run([
        agent({
          id: "2",
          agent: "posthog_events",
          pullRequest: { repo: "Org/platform", number: 7, url: "https://github.com/Org/platform/pull/7", state: "open" },
          review: { verdict: "concerns", summary: "One property looks risky." },
        }),
      ]),
    );
    render(<AnalyticsAutomationTab />);

    const link = screen.getByRole("link", { name: "Org/platform#7" });
    expect(link).toHaveAttribute("href", "https://github.com/Org/platform/pull/7");
    expect(screen.getByText(strings.prOpen)).toBeInTheDocument();
    expect(screen.getByText(strings.reviewConcerns)).toBeInTheDocument();
  });

  it("lets a reader approve the dbt proposal", async () => {
    approveMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    open(
      run([
        agent({
          id: "3",
          agent: "dbt_metrics",
          status: "awaiting_approval",
          canApprove: true,
          canReject: true,
          summary: "Two changes needed.",
          findings: [
            { id: "f1", kind: "dbt_change", title: "Add lesson_completed", detail: "New event", payload: {}, status: "proposed" },
          ],
        }),
      ]),
    );
    const user = userEvent.setup();
    render(<AnalyticsAutomationTab />);

    expect(screen.getByText("Add lesson_completed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: strings.approve }));
    expect(approveMock).toHaveBeenCalledWith("3");
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it("lets a reader reject the dbt proposal", async () => {
    rejectMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    open(
      run([
        agent({ id: "3", agent: "dbt_metrics", status: "awaiting_approval", canApprove: true, canReject: true, summary: "s" }),
      ]),
    );
    const user = userEvent.setup();
    render(<AnalyticsAutomationTab />);

    await user.click(screen.getByRole("button", { name: strings.reject }));
    expect(rejectMock).toHaveBeenCalledWith("3");
  });

  it("says so when approving fails, instead of failing silently", async () => {
    approveMock.mockReturnValue({ unwrap: () => Promise.reject({ status: 409 }) });
    open(
      run([agent({ id: "3", agent: "dbt_metrics", status: "awaiting_approval", canApprove: true, canReject: true, summary: "s" })]),
    );
    const user = userEvent.setup();
    render(<AnalyticsAutomationTab />);

    await user.click(screen.getByRole("button", { name: strings.approve }));
    expect(await screen.findByText(strings.approveFailed)).toBeInTheDocument();
  });

  it("offers no decision once the proposal is decided", () => {
    open(
      run([
        agent({ id: "3", agent: "dbt_metrics", status: "rejected", decision: "rejected", summary: "s" }),
      ]),
    );
    render(<AnalyticsAutomationTab />);
    expect(screen.queryByRole("button", { name: strings.approve })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.reject })).not.toBeInTheDocument();
    expect(screen.getAllByText(strings.decisionRejected).length).toBeGreaterThan(0);
  });

  it("flags a run that is waiting on a person in the sidebar", () => {
    open(run([agent({ id: "3", agent: "dbt_metrics", status: "awaiting_approval", canApprove: true, canReject: true, summary: "s" })]));
    render(<AnalyticsAutomationTab />);
    const sidebar = screen.getByRole("complementary", { name: strings.historyTitle });
    expect(within(sidebar).getByText(strings.statusAwaitingApproval)).toBeInTheDocument();
  });
});
