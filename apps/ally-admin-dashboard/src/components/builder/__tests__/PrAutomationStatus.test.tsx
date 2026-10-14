import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderPullRequest } from "@types";

vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tag: ({ children }: any) => <span>{children}</span>,
}));

// eslint-disable-next-line import/first
import { AutomationBudgetLine } from "../PrAutomationStatus";

const HOUR = 60 * 60 * 1000;

const pr = (extra: Partial<BuilderPullRequest> = {}): BuilderPullRequest =>
  ({
    id: "pr-1",
    merged: false,
    state: "open",
    fixRunCount: 1,
    automationCostUsd: "0",
    // 30 minutes into a 90-minute box, leaving an hour (give or take the test's run time).
    reviewHistory: [
      { sha: "a", count: 1, keys: [], at: new Date(Date.now() - 30 * 60_000).toISOString() },
    ],
    ...extra,
  }) as BuilderPullRequest;

const line = (pullRequest: BuilderPullRequest, maxSpendUsd: string | null = "10.00") =>
  render(
    <AutomationBudgetLine
      pullRequest={pullRequest}
      maxRounds={2}
      timeboxMs={1.5 * HOUR}
      maxSpendUsd={maxSpendUsd}
    />,
  );

describe("AutomationBudgetLine", () => {
  it("adds what review and fixes have spent against the limit", () => {
    line(pr({ automationCostUsd: "3.4120" }));
    expect(screen.getByText(/^Round 2 of 2 · (59m|1h) left · \$3\.41 of \$10\.00$/)).toBeTruthy();
  });

  it("drops the limit when there is none", () => {
    const { unmount } = line(pr({ automationCostUsd: "3.4120" }), null);
    expect(screen.getByText(/^Round 2 of 2 · (59m|1h) left · \$3\.41 spent$/)).toBeTruthy();
    unmount();
    line(pr({ automationCostUsd: "3.4120" }), "0");
    expect(screen.getByText(/· \$3\.41 spent$/)).toBeTruthy();
  });

  it("says nothing about money before anything is spent", () => {
    line(pr({ automationCostUsd: "0" }));
    expect(screen.getByText(/^Round 2 of 2 · (59m|1h) left$/)).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("keeps only what it cost once merged or handed to a person", () => {
    const { unmount } = line(pr({ merged: true, state: "closed", automationCostUsd: "4.12" }));
    expect(screen.getByText("Spent $4.12 on review and fixes")).toBeTruthy();
    expect(screen.queryByText(/Round/)).toBeNull();
    unmount();

    line(pr({ needsHumanAt: "2026-10-15T10:00:00Z", automationCostUsd: "10.40" }));
    expect(screen.getByText("Spent $10.40 on review and fixes")).toBeTruthy();
  });

  it("shows nothing for a merged pull request that cost nothing", () => {
    const { container } = line(pr({ merged: true, state: "closed", automationCostUsd: "0" }));
    expect(container).toBeEmptyDOMElement();
  });
});
