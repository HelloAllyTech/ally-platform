import { fireEvent, render, screen } from "@testing-library/react";
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

// The feed is stubbed to record what it was HANDED, so the chain's filtering of
// status-restating lines can be read off it. Loading the real module pulls in
// the API layer, so its count is stubbed too: every event is an update here.
let feedEvents: any[] = [];
vi.mock("../BuildActivityFeed", () => ({
  countFeedUpdates: (events: any[]) => events.length,
  BuildActivityFeed: ({ events }: any) => {
    feedEvents = events;
    return <div data-testid="feed" />;
  },
}));
vi.mock("../PhaseRail", () => ({ PhaseRail: () => <div>PhaseRail</div> }));
vi.mock("../IssueRail", () => ({ IssueRail: () => <div>IssueRail</div> }));
let repoChainProps: any = null;
vi.mock("../RepoChain", () => ({
  RepoChain: (props: any) => {
    repoChainProps = props;
    return <div>RepoChain</div>;
  },
}));
vi.mock("../RunHistoryRail", () => ({ RunHistoryRail: () => <div /> }));
vi.mock("../TodoPanel", () => ({ TodoPanel: () => <div /> }));
vi.mock("../QuestionCard", () => ({ QuestionCard: () => <div /> }));
vi.mock("../RaiseBudgetDialog", () => ({ RaiseBudgetDialog: () => null }));
vi.mock("../CollapsibleSection", () => ({
  CollapsibleSection: ({ heading, meta, defaultOpen = true, children }: any) => (
    <details open={defaultOpen} data-testid={`section-${heading}`}>
      <summary>
        {heading} {meta}
      </summary>
      {children}
    </details>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@hooks", () => ({
  useBuilderSocket: () => ({ connected: true, markSeen: () => undefined }),
}));

let runs: any[] = [];
let pullRequests: any[] = [];
let milestones: any[] = [];
let prFeedback: any[] = [];
const resumeAutomation = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
let events: any[] = [];

vi.mock("@api", () => ({
  useGetBuilderRunsQuery: () => ({ data: runs }),
  useGetBuilderMilestonesQuery: () => ({ data: milestones }),
  useGetBuilderPendingQuestionsQuery: () => ({ data: [] }),
  useGetBuilderPullRequestsQuery: () => ({ data: pullRequests }),
  useMergeBuilderPullRequestMutation: () => [vi.fn(), { isLoading: false }],
  useGetBuilderPrFeedbackQuery: () => ({ data: prFeedback }),
  useGetBuilderSettingsQuery: () => ({
    data: { maxFixRunsPerPr: 3, automationTimeboxMs: 3 * 60 * 60 * 1000 },
  }),
  useResumeBuilderPullRequestAutomationMutation: () => [resumeAutomation, { isLoading: false }],
  useGetBuilderSessionBudgetQuery: () => ({ data: undefined, refetch: vi.fn() }),
  useLazyGetBuilderRunEventsQuery: () => [
    vi.fn().mockImplementation(() => ({ unwrap: () => Promise.resolve({ events }) })),
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
    prFeedback = [];
    runs = [];
    pullRequests = [];
    milestones = [];
    events = [];
    feedEvents = [];
    repoChainProps = null;
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

  it("opens on the issue build, not the finished review run after it", () => {
    // Ankita's session: a runner review of the PR was the newest run, and the
    // page opened on its transcript and the runner's phase rail.
    runs = [
      { ...issueRun("SUCCEEDED", ["issue", "pr:33", "ci-pass:a"]), mode: "build" },
      {
        id: "run-2",
        sequence: 2,
        mode: "review",
        status: "SUCCEEDED",
        issueNumber: null,
        cost: null,
        costUsd: "0.40",
        error: null,
        dispatchedAt: new Date().toISOString(),
      },
    ];
    pullRequests = [pr("success")];
    renderView("COMPLETED");

    expect(screen.getByText("IssueRail")).toBeInTheDocument();
    expect(screen.queryByText("PhaseRail")).toBeNull();
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

  it("keeps the pull request panel for a legacy build", () => {
    runs = [{ ...issueRun("SUCCEEDED", []), issueNumber: null, issueUrl: null, mode: "build" }];
    milestones = [{ id: "m-1", position: 0, repos: ["ally-web"], status: "COMPLETED" }];
    pullRequests = [pr("success")];
    renderView("COMPLETED");

    expect(screen.getByText("A pull request is waiting for you")).toBeInTheDocument();
  });
});

describe("BuildView pull request handed to a person", () => {
  beforeEach(() => {
    prFeedback = [];
    runs = [];
    milestones = [];
    resumeAutomation.mockClear();
  });

  it("shows Needs you, the reason, the open findings and Resume on the PR panel", async () => {
    runs = [issueRun("SUCCEEDED", ["issue", "pr:33", "ci-pass:a"])];
    pullRequests = [
      {
        ...pr("success"),
        needsHumanAt: new Date().toISOString(),
        needsHumanReason: "3 fix rounds and 2 problems remain.",
      },
    ];
    prFeedback = [
      {
        id: "f-1",
        pullRequestId: "pr-1",
        kind: "agent_review",
        status: "pending",
        body: "Null check missing\nmore",
        path: "src/a.ts",
        line: 4,
      },
      {
        id: "f-2",
        pullRequestId: "pr-1",
        kind: "agent_review",
        status: "addressed",
        body: "Already fixed",
        path: null,
        line: null,
      },
    ];
    renderView("COMPLETED");

    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByText("3 fix rounds and 2 problems remain.")).toBeInTheDocument();
    expect(screen.getByText("Null check missing")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts:4")).toBeInTheDocument();
    expect(screen.queryByText("Already fixed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resume automation" }));
    await vi.waitFor(() =>
      expect(resumeAutomation).toHaveBeenCalledWith({
        sessionId: "session-1",
        pullRequestId: "pr-1",
      }),
    );
  });
});

describe("BuildView automation budget and release health", () => {
  beforeEach(() => {
    prFeedback = [];
    milestones = [];
  });

  it("shows the round and time left on an opencode pull request still being worked", () => {
    runs = [issueRun("SUCCEEDED", ["issue", "pr:33", "ci-pass:a"])];
    pullRequests = [
      {
        ...pr("success"),
        fixRunCount: 1,
        reviewHistory: [
          { sha: "a", count: 2, keys: [], at: new Date(Date.now() - 50 * 60_000).toISOString() },
        ],
      },
    ];
    renderView("COMPLETED");

    expect(screen.getByText(/^Round 2 of 3 · 2h (9|10)m left$/)).toBeInTheDocument();
  });

  it("marks a merged pull request whose release health check is failing", () => {
    runs = [issueRun("SUCCEEDED", ["issue", "pr:33", "ci-pass:a"])];
    pullRequests = [{ ...pr("success"), merged: true, state: "closed", releaseState: "unhealthy" }];
    renderView("COMPLETED");

    expect(screen.getByText("Released — health check failing")).toBeInTheDocument();
    expect(
      screen.getByText("Builder stopped automatic merges and releases. Check the service."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Merged")).toBeNull();
  });
});

describe("BuildView pull request panel while Builder is working it", () => {
  beforeEach(() => {
    prFeedback = [];
    milestones = [];
    prFeedback = [];
  });

  it("holds Merge and says Builder is reviewing it", () => {
    runs = [
      issueRun("SUCCEEDED", ["issue", "pr:33", "ci-pass:a"]),
      {
        id: "run-2",
        sequence: 2,
        mode: "review",
        status: "RUNNING",
        pullRequestId: "pr-1",
        issueNumber: null,
        cost: null,
        error: null,
        dispatchedAt: new Date().toISOString(),
      },
    ];
    pullRequests = [pr("success")];
    renderView("COMPLETED");

    expect(screen.getByText("Builder is reviewing this")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.queryByText(/Ready for review/)).toBeNull();
  });

  it("says opencode is fixing what the review found", () => {
    runs = [issueRun("SUCCEEDED", ["issue", "pr:33", "ci-pass:a"])];
    pullRequests = [pr("success")];
    prFeedback = [
      { id: "f", pullRequestId: "pr-1", kind: "agent_review", status: "in_fix", body: "x" },
    ];
    renderView("COMPLETED");

    expect(screen.getByText("opencode is fixing what the review found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });
});

describe("BuildView chained issue builds", () => {
  const chainRun = (id: string, repo: string, milestoneId: string, status = "SUCCEEDED") => ({
    id,
    sequence: Number(id.slice(-1)),
    mode: "build",
    status,
    issueNumber: 40 + Number(id.slice(-1)),
    issueUrl: `https://github.com/org/${repo}/issues/4${id.slice(-1)}`,
    repos: [repo],
    milestoneId,
    cost: { issueTimeline: ["issue", "pr:9", "ci-pass:a"] },
    costUsd: null,
    error: null,
    dispatchedAt: new Date().toISOString(),
  });

  const event = (seq: number, type: string, payload: Record<string, unknown>) => ({
    id: `e-${seq}`,
    runId: "run-2",
    seq,
    stage: null,
    type,
    payload,
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    prFeedback = [];
    milestones = [
      { id: "m-be", position: 0, repos: ["ally-be"], status: "COMPLETED" },
      { id: "m-web", position: 1, repos: ["ally-web"], status: "COMPLETED" },
    ];
    runs = [chainRun("run-1", "ally-be", "m-be"), chainRun("run-2", "ally-web", "m-web")];
    pullRequests = [pr("success")];
    feedEvents = [];
    events = [
      event(1, "text", {
        text: "opencode opened https://github.com/org/ally-web/pull/33. CI checks it next.",
      }),
      event(2, "text", { text: "CI is running on abc1234." }),
      event(3, "ci_result", { repo: "ally-web", state: "pending", failed: [] }),
      event(4, "ci_result", { repo: "ally-web", state: "failure", failed: ["Vitest"] }),
      event(5, "text", { text: "Asked opencode to fix the failing checks on … (request 1 of 2)." }),
      event(6, "text", { text: "CI passed on def5678. The build is done; … is ready for review." }),
    ];
  });

  it("drops the pull request panel and hands merging to the repo table", () => {
    renderView("COMPLETED");

    expect(screen.queryByText("A pull request is waiting for you")).toBeNull();
    expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
    expect(repoChainProps.onMerge).toEqual(expect.any(Function));
    // No rail row or link row above the feed: the table carries both.
    expect(screen.queryByText("IssueRail")).toBeNull();
    expect(screen.queryByRole("link", { name: "PR #33" })).toBeNull();
  });

  it("folds the activity when nothing is building, and drops lines that restate the table", async () => {
    renderView("COMPLETED");

    const section = screen.getByTestId("section-Activity: ally-web");
    expect(section).not.toHaveAttribute("open");

    // Kept: the CI card that names a failing check, and the fix request.
    // Dropped: "opencode opened …", "CI is running on …", "CI passed on …",
    // and the CI card with nothing failing — the table shows all of those.
    await vi.waitFor(() => expect(feedEvents.map(e => e.seq)).toEqual([4, 5]));
    expect(section).toHaveTextContent("2 updates");
  });

  it("opens the activity while a repo is building", () => {
    runs = [
      chainRun("run-1", "ally-be", "m-be"),
      chainRun("run-2", "ally-web", "m-web", "RUNNING"),
    ];
    milestones[1].status = "BUILDING";
    renderView("BUILDING");

    expect(screen.getByTestId("section-Activity: ally-web")).toHaveAttribute("open");
  });
});
