import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderBuildRun } from "@types";

vi.mock("@components", () => ({ cellTypes: {} }));

// eslint-disable-next-line import/first
import { IssueRail } from "../IssueRail";

const run = (timeline: string[], overrides: Partial<BuilderBuildRun> = {}): BuilderBuildRun =>
  ({
    id: "run-1",
    status: "RUNNING",
    issueNumber: 3,
    issueUrl: "https://github.com/org/ally-be/issues/3",
    repos: ["ally-be"],
    cost: {
      issueTimeline: timeline,
      issueFixRequests: timeline.filter(k => k.startsWith("fix:")).map(k => k.slice(4)),
    },
    ...overrides,
  }) as unknown as BuilderBuildRun;

const current = () =>
  screen.getAllByRole("listitem").find(item => item.querySelector('[aria-current="step"]'))
    ?.textContent;

describe("IssueRail", () => {
  it("shows opencode working once the issue is raised", () => {
    render(<IssueRail run={run(["issue", "working:111"])} />);
    expect(current()).toBe("opencode working");
  });

  it("names the pull request and says CI failed with the fix count", () => {
    render(
      <IssueRail
        run={run(["issue", "working:111", "pr:12", "ci-pending:a", "ci-fail:a", "fix:a"])}
      />,
    );
    expect(screen.getByText("Pull request opened #12")).toBeInTheDocument();
    expect(current()).toBe("Asked opencode to fix · fix requested 1 of 2");
  });

  it("reads the latest CI state after a fix was pushed", () => {
    render(
      <IssueRail run={run(["issue", "working:1", "pr:4", "ci-fail:a", "fix:a", "ci-pending:b"])} />,
    );
    expect(current()).toBe("CI running · fix requested 1 of 2");
  });

  it("marks every step done once CI passes", () => {
    render(
      <IssueRail run={run(["issue", "working:1", "pr:4", "ci-pass:a"], { status: "SUCCEEDED" })} />,
    );
    expect(current()).toBeUndefined();
    expect(screen.getByText("CI passed")).toBeInTheDocument();
  });

  it("does not go blank for a fresh run with no timeline yet", () => {
    render(<IssueRail run={run([], { status: "QUEUED" })} />);
    expect(current()).toBe("opencode working");
  });
});
