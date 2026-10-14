import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// See BuildView.budget.test.tsx for why the barrel and the design system are
// stubbed rather than loaded.
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ActionableNotification: ({ title }: any) => <div>{title}</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Tile: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("../BuildActivityFeed", () => ({ BuildActivityFeed: () => <div /> }));
vi.mock("../PhaseRail", () => ({ PhaseRail: () => <div>PhaseRail</div> }));
vi.mock("../IssueRail", () => ({ IssueRail: () => <div>IssueRail</div> }));
vi.mock("../RepoChain", () => ({ RepoChain: () => null }));
vi.mock("../RunHistoryRail", () => ({ RunHistoryRail: () => <div /> }));
vi.mock("../TodoPanel", () => ({ TodoPanel: () => <div /> }));
vi.mock("../QuestionCard", () => ({ QuestionCard: () => <div /> }));
vi.mock("../RaiseBudgetDialog", () => ({ RaiseBudgetDialog: () => null }));
vi.mock("../CollapsibleSection", () => ({
  CollapsibleSection: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@hooks", () => ({
  useBuilderSocket: () => ({ connected: true, markSeen: () => undefined }),
}));

let runs: any[] = [];
let pullRequests: any[] = [];

vi.mock("@api", () => ({
  useGetBuilderRunsQuery: () => ({ data: runs }),
  useGetBuilderMilestonesQuery: () => ({ data: [] }),
  useGetBuilderPendingQuestionsQuery: () => ({ data: [] }),
  useGetBuilderPullRequestsQuery: () => ({ data: pullRequests }),
  useMergeBuilderPullRequestMutation: () => [vi.fn(), { isLoading: false }],
  useGetBuilderSessionBudgetQuery: () => ({ data: undefined, refetch: vi.fn() }),
  useLazyGetBuilderRunEventsQuery: () => [
    vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ events: [] }) }),
  ],
  useAnswerBuilderQuestionMutation: () => [vi.fn(), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { BuildView } from "../BuildView";

const issueRun = (status: string, timeline: string[], workflowUrl?: string) => ({
  id: "run-1",
  sequence: 1,
  status,
  issueNumber: 21,
  issueUrl: "https://github.com/org/ally-web/issues/21",
  githubRunUrl: "https://github.com/org/ally-web/issues/21",
  repos: ["ally-web"],
  milestoneId: null,
  cost: { issueTimeline: timeline, issueWorkflowRunUrl: workflowUrl },
  costUsd: null,
  error: null,
  dispatchedAt: new Date().toISOString(),
});

const pr = (ciStatus: string) => ({
  id: "pr-1",
  repo: "ally-web",
  prNumber: 33,
  prUrl: "https://github.com/org/ally-web/pull/33",
  title: "Add the thing",
  ciStatus,
  merged: false,
  state: "open",
});

const renderView = (status: "BUILDING" | "COMPLETED") =>
  render(<BuildView sessionId="session-1" status={status} currentStage="SETUP" />);

describe("BuildView issue builds", () => {
  beforeEach(() => {
    runs = [];
    pullRequests = [];
  });

  it("uses the issue rail and labeled links instead of the phase rail", () => {
    runs = [
      issueRun("RUNNING", ["issue", "working:5", "pr:33"], "https://github.com/x/actions/runs/5"),
    ];
    renderView("BUILDING");

    expect(screen.getByText("IssueRail")).toBeInTheDocument();
    expect(screen.queryByText("PhaseRail")).toBeNull();
    expect(screen.getByRole("link", { name: "Issue ally-web#21" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Actions log" })).toHaveAttribute(
      "href",
      "https://github.com/x/actions/runs/5",
    );
    expect(screen.getByRole("link", { name: "PR #33" })).toHaveAttribute(
      "href",
      "https://github.com/org/ally-web/pull/33",
    );
  });

  it("disables Merge while opencode is still working on CI", () => {
    runs = [issueRun("RUNNING", ["issue", "working:5", "pr:33", "ci-fail:a", "fix:a"])];
    pullRequests = [pr("failure")];
    renderView("BUILDING");

    expect(screen.getByText("CI failed")).toBeInTheDocument();
    expect(screen.getByText("opencode is still working on CI")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("keeps Merge disabled on a finished build whose CI is not green", () => {
    runs = [issueRun("FAILED", ["issue", "working:5", "pr:33", "ci-fail:a"])];
    pullRequests = [pr("failure")];
    renderView("COMPLETED");

    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("says the review is yours once CI is green", () => {
    runs = [issueRun("SUCCEEDED", ["issue", "working:5", "pr:33", "ci-pass:a"])];
    pullRequests = [pr("success")];
    renderView("COMPLETED");

    expect(screen.getByText("CI passed")).toBeInTheDocument();
    expect(
      screen.getByText(/Ready for review — approve it on GitHub, then merge/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open on GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).not.toBeDisabled();
  });

  it("leaves a legacy build on the phase rail with Merge enabled", () => {
    runs = [{ ...issueRun("SUCCEEDED", []), issueNumber: null, issueUrl: null }];
    pullRequests = [pr("pending")];
    renderView("COMPLETED");

    expect(screen.getByText("PhaseRail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).not.toBeDisabled();
  });
});
