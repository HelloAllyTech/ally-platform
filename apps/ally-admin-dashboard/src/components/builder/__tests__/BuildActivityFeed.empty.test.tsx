import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderBuildEvent } from "@types";

// @constants reads off the @components barrel at module-eval time (see the
// BugHunter tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => undefined }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Tile: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// eslint-disable-next-line import/first
import { BuildActivityFeed } from "../BuildActivityFeed";

/**
 * What an empty-looking feed says. It used to say "Waiting for the first
 * update…" over a run that already had hundreds of events, for as long as the
 * first fetch took — which reads as a build that never started.
 */

const hidden = (type: string, seq: number): BuilderBuildEvent =>
  ({
    id: `event-${seq}`,
    runId: "run-1",
    sessionId: "session-1",
    seq,
    stage: null,
    type,
    payload: {},
    createdAt: new Date().toISOString(),
  }) as unknown as BuilderBuildEvent;

describe("BuildActivityFeed empty states", () => {
  it("says it is loading until the run's events have been fetched", () => {
    render(<BuildActivityFeed events={[]} isLive isLoading />);
    expect(screen.getByText("Loading this run's activity…")).toBeInTheDocument();
  });

  it("says the agent is working when only unshown events have arrived", () => {
    render(<BuildActivityFeed events={[hidden("tool_result", 1), hidden("todo", 2)]} isLive />);
    expect(screen.getByText(/Working — 2 steps so far/)).toBeInTheDocument();
  });

  it("says the runner is starting when a live run has nothing yet", () => {
    render(<BuildActivityFeed events={[]} isLive />);
    expect(screen.getByText(/The runner is starting/)).toBeInTheDocument();
  });

  it("says nothing was recorded for a finished run with no events", () => {
    render(<BuildActivityFeed events={[]} isLive={false} />);
    expect(screen.getByText("Nothing recorded for this run.")).toBeInTheDocument();
  });
});
