import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderBuildRun, BuilderMilestone, BuilderPullRequest } from "@types";

vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tag: ({ children }: any) => <span>{children}</span>,
  // `kind` is surfaced so the one primary action can be told from the rest.
  Button: ({ children, onClick, disabled, kind, title }: any) => (
    <button onClick={onClick} disabled={disabled} data-kind={kind} title={title}>
      {children}
    </button>
  ),
}));
vi.mock("../IssueRail", () => ({ IssueRail: () => <span>IssueRail</span> }));

// eslint-disable-next-line import/first
import { RepoChain } from "../RepoChain";

const milestone = (
  id: string,
  position: number,
  repo: string | null,
  status: BuilderMilestone["status"],
  error: string | null = null,
): BuilderMilestone =>
  ({ id, position, repos: repo ? [repo] : null, status, error, title: id }) as BuilderMilestone;

const run = (
  id: string,
  repo: string,
  milestoneId: string,
  status: string,
  timeline: string[],
): BuilderBuildRun =>
  ({
    id,
    mode: "build",
    status,
    issueNumber: Number(id.replace(/\D/g, "")) + 100,
    issueUrl: `https://github.com/org/${repo}/issues/${Number(id.replace(/\D/g, "")) + 100}`,
    repos: [repo],
    milestoneId,
    cost: {
      issueTimeline: timeline,
      issueWorkflowRunUrl: `https://github.com/org/${repo}/actions/1`,
    },
  }) as unknown as BuilderBuildRun;

const pr = (
  id: string,
  repo: string,
  prNumber: number,
  ciStatus: string,
  merged = false,
): BuilderPullRequest =>
  ({
    id,
    repo,
    prNumber,
    prUrl: `https://github.com/org/${repo}/pull/${prNumber}`,
    ciStatus,
    merged,
    state: merged ? "closed" : "open",
  }) as unknown as BuilderPullRequest;

/** Ankita's session: three repos built, three green pull requests, none merged. */
const threeBuilt = {
  milestones: [
    milestone("m-mobile", 3, "ally-mobile", "COMPLETED"),
    milestone("m-web", 2, "ally-web", "COMPLETED"),
    milestone("m-be", 1, "ally-be", "COMPLETED"),
    milestone("m-epic", 0, null, "COMPLETED"),
  ],
  runs: [
    run("run-1", "ally-be", "m-be", "SUCCEEDED", ["issue", "pr:630", "ci-pass:a"]),
    run("run-2", "ally-web", "m-web", "SUCCEEDED", ["issue", "pr:817", "ci-pass:b"]),
    run("run-3", "ally-mobile", "m-mobile", "SUCCEEDED", ["issue", "pr:114", "ci-pass:c"]),
  ],
  pullRequests: [
    pr("pr-be", "ally-be", 630, "success"),
    pr("pr-web", "ally-web", 817, "success"),
    pr("pr-mobile", "ally-mobile", 114, "success"),
  ],
};

const rowFor = (repo: string) =>
  screen.getAllByRole("listitem").find(row => row.textContent?.includes(repo)) as HTMLElement;

describe("RepoChain", () => {
  it("gives each repo one row, in build order, with its PR, CI and next step", () => {
    render(<RepoChain {...threeBuilt} onMerge={vi.fn()} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map(row => row.textContent?.match(/ally-[a-z]+/)?.[0])).toEqual([
      "ally-be",
      "ally-web",
      "ally-mobile",
    ]);
    expect(within(rows[0]).getByText("Built")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "#630" })).toHaveAttribute(
      "href",
      "https://github.com/org/ally-be/pull/630",
    );
    expect(within(rows[0]).getByLabelText("CI passed")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Waiting for your review")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Merge after ally-be")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Merge after ally-web")).toBeInTheDocument();
    // Once there is a pull request, the issue is not linked as well.
    expect(screen.queryByRole("link", { name: /Issue #/ })).toBeNull();
    // Nothing is building, so there is no progress line at all.
    expect(screen.queryByText("IssueRail")).toBeNull();
  });

  it("makes the first unmerged pull request the only primary action", () => {
    const onMerge = vi.fn();
    render(<RepoChain {...threeBuilt} onMerge={onMerge} />);

    const buttons = screen.getAllByRole("button", { name: /Merge/ });
    expect(buttons.filter(button => button.dataset.kind === "primary")).toHaveLength(1);
    const primary = within(rowFor("ally-be")).getByRole("button", { name: "Merge first" });
    expect(primary).toHaveAttribute("data-kind", "primary");
    expect(primary.getAttribute("title")).toMatch(/approving review/);
    expect(within(rowFor("ally-web")).getByRole("button", { name: "Merge" })).toHaveAttribute(
      "data-kind",
      "ghost",
    );

    fireEvent.click(primary);
    expect(onMerge).toHaveBeenCalledWith("pr-be");
  });

  it("moves the primary action down once earlier pull requests are merged", () => {
    render(
      <RepoChain
        {...threeBuilt}
        pullRequests={[
          pr("pr-be", "ally-be", 630, "success", true),
          pr("pr-web", "ally-web", 817, "success", true),
          pr("pr-mobile", "ally-mobile", 114, "success"),
        ]}
        onMerge={vi.fn()}
      />,
    );

    expect(within(rowFor("ally-be")).getByText("Merged")).toBeInTheDocument();
    expect(within(rowFor("ally-be")).queryByRole("button")).toBeNull();
    // The last one left has nothing waiting on it, so it is plain "Merge".
    expect(within(rowFor("ally-mobile")).getByRole("button", { name: "Merge" })).toHaveAttribute(
      "data-kind",
      "primary",
    );
  });

  it("offers no primary anywhere while the first unmerged pull request is not ready", () => {
    // Build order is merge order: ally-web was built on ally-be's changes, so
    // a green ally-web must not be offered ahead of a red ally-be.
    render(
      <RepoChain
        {...threeBuilt}
        runs={[
          run("run-1", "ally-be", "m-be", "FAILED", ["issue", "pr:630", "ci-fail:a"]),
          ...threeBuilt.runs.slice(1),
        ]}
        pullRequests={[
          pr("pr-be", "ally-be", 630, "failure"),
          pr("pr-web", "ally-web", 817, "success"),
          pr("pr-mobile", "ally-mobile", 114, "success"),
        ]}
        onMerge={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole("button").filter(b => b.dataset.kind === "primary")).toHaveLength(
      0,
    );
    expect(within(rowFor("ally-be")).getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(within(rowFor("ally-be")).getByText("Fix CI on the pull request")).toBeInTheDocument();
    expect(within(rowFor("ally-web")).getByText("Merge after ally-be")).toBeInTheDocument();
    expect(within(rowFor("ally-web")).getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(within(rowFor("ally-mobile")).getByText("Merge after ally-web")).toBeInTheDocument();
    expect(within(rowFor("ally-mobile")).getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  describe("while Builder is still working a pull request", () => {
    const reviewRun = (status: string) =>
      ({
        id: "run-review",
        mode: "review",
        status,
        pullRequestId: "pr-be",
        issueNumber: null,
        cost: null,
      }) as unknown as BuilderBuildRun;
    const feedbackItem = (status: string) => ({
      id: `f-${status}`,
      pullRequestId: "pr-be",
      sessionId: "s",
      kind: "agent_review" as const,
      status: status as any,
      body: "Missing null check",
      path: null,
      line: null,
    });

    it("says Builder is reviewing it, and offers no primary anywhere", () => {
      render(
        <RepoChain
          {...threeBuilt}
          runs={[...threeBuilt.runs, reviewRun("RUNNING")]}
          onMerge={vi.fn()}
        />,
      );

      const be = rowFor("ally-be");
      expect(within(be).getByText("Builder is reviewing this")).toBeInTheDocument();
      expect(within(be).queryByText("Waiting for your review")).toBeNull();
      const quiet = within(be).getByRole("button", { name: "Merge" });
      expect(quiet).toHaveAttribute("data-kind", "ghost");
      expect(quiet).toBeDisabled();
      expect(quiet).toHaveAttribute("title", "Builder is still working on this pull request");

      expect(
        screen.queryAllByRole("button").filter(b => b.dataset.kind === "primary"),
      ).toHaveLength(0);
      expect(within(rowFor("ally-web")).getByText("Merge after ally-be")).toBeInTheDocument();
      expect(within(rowFor("ally-web")).getByRole("button", { name: "Merge" })).toBeDisabled();
    });

    it("leaves the row ready once the review run has finished", () => {
      render(
        <RepoChain
          {...threeBuilt}
          runs={[...threeBuilt.runs, reviewRun("SUCCEEDED")]}
          onMerge={vi.fn()}
        />,
      );
      expect(
        within(rowFor("ally-be")).getByRole("button", { name: "Merge first" }),
      ).toHaveAttribute("data-kind", "primary");
    });

    it("says opencode is fixing what the review found while a finding is in fix", () => {
      render(<RepoChain {...threeBuilt} feedback={[feedbackItem("in_fix")]} onMerge={vi.fn()} />);
      const be = rowFor("ally-be");
      expect(within(be).getByText("opencode is fixing what the review found")).toBeInTheDocument();
      expect(within(be).getByRole("button", { name: "Merge" })).toBeDisabled();
    });

    it("says the findings are on their way while one is pending", () => {
      render(<RepoChain {...threeBuilt} feedback={[feedbackItem("pending")]} onMerge={vi.fn()} />);
      expect(
        within(rowFor("ally-be")).getByText("Sending the review's findings to opencode"),
      ).toBeInTheDocument();
    });

    it("ignores findings that are already dealt with", () => {
      render(
        <RepoChain {...threeBuilt} feedback={[feedbackItem("addressed")]} onMerge={vi.fn()} />,
      );
      expect(within(rowFor("ally-be")).getByText("Waiting for your review")).toBeInTheDocument();
    });

    it("says a pull request reviewed clean on its current commit is ready to merge", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[
            { ...threeBuilt.pullRequests[0], headSha: "abc", reviewPassedSha: "abc" } as any,
            ...threeBuilt.pullRequests.slice(1),
          ]}
          onMerge={vi.fn()}
        />,
      );
      expect(
        within(rowFor("ally-be")).getByText("Reviewed clean — ready to merge"),
      ).toBeInTheDocument();
    });

    it("does not call a review clean once a new commit landed after it", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[
            { ...threeBuilt.pullRequests[0], headSha: "def", reviewPassedSha: "abc" } as any,
            ...threeBuilt.pullRequests.slice(1),
          ]}
          onMerge={vi.fn()}
        />,
      );
      expect(within(rowFor("ally-be")).getByText("Waiting for your review")).toBeInTheDocument();
    });
  });

  it("puts the progress line under the building row only, and links the issue until a PR exists", () => {
    render(
      <RepoChain
        milestones={[
          milestone("m-be", 1, "ally-be", "COMPLETED"),
          milestone("m-web", 2, "ally-web", "BUILDING"),
          milestone("m-mobile", 3, "ally-mobile", "PENDING"),
        ]}
        runs={[
          threeBuilt.runs[0],
          run("run-2", "ally-web", "m-web", "RUNNING", ["issue", "working:5"]),
        ]}
        pullRequests={[pr("pr-be", "ally-be", 630, "success")]}
        onMerge={vi.fn()}
      />,
    );

    expect(within(rowFor("ally-web")).getByText("IssueRail")).toBeInTheDocument();
    expect(screen.getAllByText("IssueRail")).toHaveLength(1);
    expect(rowFor("ally-web")).toHaveAttribute("aria-current", "step");
    expect(
      within(rowFor("ally-web")).getByRole("link", { name: "Issue #102" }),
    ).toBeInTheDocument();
    expect(
      within(rowFor("ally-web")).getByRole("link", { name: "Actions log" }),
    ).toBeInTheDocument();
    expect(within(rowFor("ally-mobile")).getByText("Starts after ally-web")).toBeInTheDocument();
  });

  it("shows a failed repo's error under its row", () => {
    render(
      <RepoChain
        milestones={[milestone("m-be", 1, "ally-be", "FAILED", "CI never went green")]}
        runs={[]}
        pullRequests={[]}
      />,
    );
    expect(within(rowFor("ally-be")).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("CI never went green")).toBeInTheDocument();
  });

  it("switches the feed to a repo's build, and marks the one on screen", () => {
    const onSelectRun = vi.fn();
    render(<RepoChain {...threeBuilt} selectedRunId="run-2" onSelectRun={onSelectRun} />);

    fireEvent.click(screen.getByRole("button", { name: "Show ally-be's activity" }));
    expect(onSelectRun).toHaveBeenCalledWith("run-1");
    expect(within(rowFor("ally-web")).getByText("Showing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show ally-web's activity" })).toBeNull();
  });

  describe("a pull request handed to a person", () => {
    const needsYou = (base: BuilderPullRequest) =>
      ({
        ...base,
        needsHumanAt: "2026-10-14T10:00:00Z",
        needsHumanReason: "3 fix rounds and 2 problems remain.",
      }) as BuilderPullRequest;
    const finding = (id: string, status: string, body: string, path: string | null = null) => ({
      id,
      pullRequestId: "pr-be",
      sessionId: "s",
      kind: "agent_review" as const,
      status: status as any,
      body,
      path,
      line: path ? 12 : null,
    });

    it("says Needs you, gives the reason and open findings, and offers Resume", () => {
      const onResume = vi.fn();
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[needsYou(threeBuilt.pullRequests[0]), ...threeBuilt.pullRequests.slice(1)]}
          feedback={[
            finding("f1", "pending", "## Missing null check\nDetails…", "src/a.ts"),
            finding("f2", "in_fix", "Unbounded retry"),
            finding("f3", "addressed", "Old problem"),
          ]}
          onMerge={vi.fn()}
          onResume={onResume}
        />,
      );

      const row = rowFor("ally-be");
      expect(within(row).getByText("Needs you")).toBeInTheDocument();
      expect(within(row).queryByText("Built")).toBeNull();
      expect(within(row).getByText("3 fix rounds and 2 problems remain.")).toBeInTheDocument();
      expect(within(row).getByText("Missing null check")).toBeInTheDocument();
      expect(within(row).getByText("src/a.ts:12")).toBeInTheDocument();
      expect(within(row).getByText("Unbounded retry")).toBeInTheDocument();
      expect(within(row).queryByText("Old problem")).toBeNull();
      // PR link and CI stay.
      expect(within(row).getByRole("link", { name: "#630" })).toBeInTheDocument();
      expect(within(row).getByLabelText("CI passed")).toBeInTheDocument();

      fireEvent.click(within(row).getByRole("button", { name: "Resume automation" }));
      expect(onResume).toHaveBeenCalledWith("pr-be");
    });

    it("makes Review on GitHub the one primary action when the first unmerged PR needs you", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[needsYou(threeBuilt.pullRequests[0]), ...threeBuilt.pullRequests.slice(1)]}
          onMerge={vi.fn()}
          onResume={vi.fn()}
        />,
      );

      const primaries = screen.getAllByRole("button").filter(b => b.dataset.kind === "primary");
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toHaveTextContent("Review on GitHub");
      expect(within(rowFor("ally-be")).getByRole("button", { name: "Merge" })).toHaveAttribute(
        "data-kind",
        "ghost",
      );
      expect(screen.queryByRole("button", { name: "Merge first" })).toBeNull();
    });

    it("keeps Merge first when only a later PR needs you", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[
            threeBuilt.pullRequests[0],
            needsYou(threeBuilt.pullRequests[1]),
            threeBuilt.pullRequests[2],
          ]}
          onMerge={vi.fn()}
          onResume={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Merge first" })).toHaveAttribute(
        "data-kind",
        "primary",
      );
      expect(screen.queryByRole("button", { name: "Review on GitHub" })).toBeNull();
      expect(within(rowFor("ally-web")).getByText("Needs you")).toBeInTheDocument();
    });

    it("folds all but three open findings", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[needsYou(threeBuilt.pullRequests[0]), ...threeBuilt.pullRequests.slice(1)]}
          feedback={["a", "b", "c", "d", "e"].map(x => finding(x, "pending", `Finding ${x}`))}
          onMerge={vi.fn()}
          onResume={vi.fn()}
        />,
      );
      expect(screen.queryByText("Finding d")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
      expect(screen.getByText("Finding e")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
    });
  });

  describe("automation budget and release health", () => {
    const HOUR = 60 * 60 * 1000;
    const reviewed = (base: BuilderPullRequest, extra: Partial<BuilderPullRequest> = {}) =>
      ({
        ...base,
        fixRunCount: 2,
        reviewHistory: [
          { sha: "a", count: 3, keys: [], at: new Date(Date.now() - 2.5 * HOUR).toISOString() },
        ],
        ...extra,
      }) as BuilderPullRequest;

    it("puts the round and time left under a row Builder is still working", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[reviewed(threeBuilt.pullRequests[0]), ...threeBuilt.pullRequests.slice(1)]}
          maxFixRuns={3}
          timeboxMs={3 * HOUR}
        />,
      );
      expect(within(rowFor("ally-be")).getByText(/^Round 3 of 3 · (29|30)m left$/)).toBeTruthy();
      // No review yet on the others: no clock, so no line.
      expect(within(rowFor("ally-web")).queryByText(/^Round/)).toBeNull();
    });

    it("hides the budget once the pull request needs a person or has merged", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[
            reviewed(threeBuilt.pullRequests[0], { merged: true, state: "closed" }),
            reviewed(threeBuilt.pullRequests[1], {
              needsHumanAt: "2026-10-14T10:00:00Z",
              needsHumanReason: "3 fix rounds and 2 problems remain.",
            }),
            threeBuilt.pullRequests[2],
          ]}
          maxFixRuns={3}
          timeboxMs={3 * HOUR}
        />,
      );
      expect(screen.queryByText(/^Round/)).toBeNull();
    });

    it("tags a release whose health check is failing, in place of Merged", () => {
      render(
        <RepoChain
          {...threeBuilt}
          pullRequests={[
            {
              ...threeBuilt.pullRequests[0],
              merged: true,
              state: "closed",
              releaseState: "unhealthy",
            } as BuilderPullRequest,
            ...threeBuilt.pullRequests.slice(1),
          ]}
          onMerge={vi.fn()}
        />,
      );
      const row = rowFor("ally-be");
      expect(within(row).getByText("Released — health check failing")).toBeInTheDocument();
      expect(within(row).queryByText("Merged")).toBeNull();
      expect(
        within(row).getByText("Builder stopped automatic merges and releases. Check the service."),
      ).toBeInTheDocument();
    });
  });

  it("renders nothing without repo milestones", () => {
    const { container } = render(
      <RepoChain
        milestones={[milestone("m-epic", 0, null, "BUILDING")]}
        runs={[]}
        pullRequests={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
