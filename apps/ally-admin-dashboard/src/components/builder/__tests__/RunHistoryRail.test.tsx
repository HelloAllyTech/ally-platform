import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderBuildRun } from "@types";

// @constants reads off the @components barrel at module-eval time (see the
// BugHunter tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tag: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("../CollapsibleSection", () => ({
  CollapsibleSection: ({ children, heading, defaultOpen = true }: any) => (
    <div data-heading={heading} data-open={String(defaultOpen)}>
      {children}
    </div>
  ),
}));

// eslint-disable-next-line import/first
import { RunHistoryRail } from "../RunHistoryRail";

const run = (overrides: Partial<BuilderBuildRun>): BuilderBuildRun =>
  ({
    id: `run-${overrides.sequence}`,
    sessionId: "session-1",
    mode: "build",
    status: "SUCCEEDED",
    model: "gemini-2.5-pro",
    branchSlug: "x",
    branches: null,
    githubRunUrl: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    cost: null,
    costUsd: null,
    ...overrides,
  }) as unknown as BuilderBuildRun;

/**
 * A run stays QUEUED on our side until its first event arrives, which can be a
 * minute after GitHub has already started it. Once GitHub has it, "Queued"
 * reads as stuck.
 */
describe("RunHistoryRail status", () => {
  it("says Starting once GitHub has accepted a queued run", () => {
    render(
      <RunHistoryRail
        runs={[
          run({ sequence: 1 }),
          run({
            sequence: 2,
            status: "QUEUED",
            githubRunUrl: "https://github.com/x/actions/runs/1",
          }),
        ]}
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("Starting")).toBeInTheDocument();
    expect(screen.queryByText("Queued")).not.toBeInTheDocument();
  });

  it("says Queued while GitHub has not picked it up", () => {
    render(
      <RunHistoryRail
        runs={[run({ sequence: 1 }), run({ sequence: 2, status: "QUEUED" })]}
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });
});

describe("RunHistoryRail issue builds", () => {
  const issueRun = run({
    sequence: 1,
    status: "RUNNING",
    issueNumber: 42,
    issueUrl: "https://github.com/org/ally-be/issues/42",
    repos: ["ally-be"],
  });

  it("names the repo and issue, and says cost is not tracked rather than showing $0", () => {
    render(
      <RunHistoryRail
        runs={[issueRun, { ...issueRun, id: "run-2", sequence: 2 }]}
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("Run 1 · ally-be · issue #42")).toBeInTheDocument();
    expect(screen.getAllByText("Cost not tracked")).toHaveLength(2);
  });

  it("hides a lone run: the repo chain already names it", () => {
    const { container } = render(
      <RunHistoryRail runs={[issueRun]} selectedRunId={null} onSelect={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("folds every run under 'All runs' in a chained session", () => {
    const { container } = render(
      <RunHistoryRail
        runs={[issueRun, { ...issueRun, id: "run-2", sequence: 2 }]}
        selectedRunId={null}
        onSelect={() => undefined}
        folded
      />,
    );
    const section = container.querySelector("[data-heading]");
    expect(section?.getAttribute("data-heading")).toBe("All runs");
    expect(section?.getAttribute("data-open")).toBe("false");
  });
});
