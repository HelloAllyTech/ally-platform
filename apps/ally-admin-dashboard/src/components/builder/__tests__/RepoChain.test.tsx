import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderBuildRun, BuilderMilestone, BuilderPullRequest } from "@types";

vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tag: ({ children }: any) => <span>{children}</span>,
}));

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

const runs = [
  {
    id: "run-1",
    status: "SUCCEEDED",
    issueNumber: 5,
    issueUrl: "https://github.com/org/ally-be/issues/5",
    repos: ["ally-be"],
    milestoneId: "m-be",
    cost: { issueTimeline: ["issue", "working:1", "pr:9", "ci-pass:a"] },
  },
  {
    id: "run-2",
    status: "RUNNING",
    issueNumber: 6,
    issueUrl: "https://github.com/org/ally-web/issues/6",
    repos: ["ally-web"],
    milestoneId: "m-web",
    cost: { issueTimeline: ["issue"] },
  },
] as unknown as BuilderBuildRun[];

const pullRequests = [
  {
    id: "pr-1",
    repo: "ally-be",
    prNumber: 9,
    prUrl: "https://github.com/org/ally-be/pull/9",
    ciStatus: "success",
    merged: false,
  },
] as unknown as BuilderPullRequest[];

describe("RepoChain", () => {
  it("lists each repo in build order with its status, links and CI", () => {
    render(
      <RepoChain
        milestones={[
          milestone("m-mobile", 3, "ally-mobile", "FAILED", "CI never went green"),
          milestone("m-web", 2, "ally-web", "BUILDING"),
          milestone("m-be", 1, "ally-be", "COMPLETED"),
          milestone("m-epic", 0, null, "COMPLETED"),
        ]}
        runs={runs}
        pullRequests={pullRequests}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows.map(row => row.textContent?.match(/ally-[a-z]+/)?.[0])).toEqual([
      "ally-be",
      "ally-web",
      "ally-mobile",
    ]);
    expect(screen.getByText("Building ally-web now")).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("CI never went green")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issue #5" })).toHaveAttribute(
      "href",
      "https://github.com/org/ally-be/issues/5",
    );
    expect(screen.getByRole("link", { name: "PR #9" })).toBeInTheDocument();
    expect(screen.getByText("CI passed")).toBeInTheDocument();
  });

  it("switches the feed to a repo's build, and marks the one on screen", () => {
    const onSelectRun = vi.fn();
    render(
      <RepoChain
        milestones={[
          milestone("m-be", 1, "ally-be", "COMPLETED"),
          milestone("m-web", 2, "ally-web", "BUILDING"),
        ]}
        runs={runs}
        pullRequests={pullRequests}
        selectedRunId="run-2"
        onSelectRun={onSelectRun}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show ally-be's activity" }));
    expect(onSelectRun).toHaveBeenCalledWith("run-1");
    expect(screen.getByText("Showing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show ally-web's activity" })).toBeNull();
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
