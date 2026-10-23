import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderBuildEvent } from "@types";

// See BuildActivityFeed.gate.test.tsx for why these are stubbed.
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

let seq = 0;
const event = (
  type: BuilderBuildEvent["type"],
  payload: Record<string, unknown>,
): BuilderBuildEvent =>
  ({
    id: `event-${(seq += 1)}`,
    runId: "run-1",
    seq,
    stage: null,
    type,
    payload,
    createdAt: new Date().toISOString(),
  }) as unknown as BuilderBuildEvent;

describe("issue builds in the feed", () => {
  it("renders the repo's CI verdict as a checked card with its failed checks", () => {
    render(
      <BuildActivityFeed
        isLive={false}
        events={[
          event("ci_result", {
            repo: "ally-web",
            prNumber: 12,
            prUrl: "https://github.com/org/ally-web/pull/12",
            sha: "abcdef1234567",
            state: "failure",
            failed: ["Typecheck", "Vitest"],
          }),
        ]}
      />,
    );

    expect(screen.getByText("CI failed")).toBeInTheDocument();
    expect(screen.getByText("Checked by the repo's CI")).toBeInTheDocument();
    expect(screen.getByText("2 checks failed")).toBeInTheDocument();
    expect(screen.getByText("Typecheck")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #12" })).toHaveAttribute(
      "href",
      "https://github.com/org/ally-web/pull/12",
    );
  });

  it("names stages in issue wording and points a live build at the Actions log", () => {
    render(
      <BuildActivityFeed
        isLive
        issueBuild={{ actionsLogUrl: "https://github.com/org/ally-web/actions/runs/9" }}
        events={[event("stage_change", { stage: "REMEDIATING" })]}
      />,
    );

    expect(screen.getByText("Asked opencode to fix")).toBeInTheDocument();
    expect(screen.getByText(/checks the issue and pull request every 5 minutes/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the Actions log" })).toHaveAttribute(
      "href",
      "https://github.com/org/ally-web/actions/runs/9",
    );
  });
});
