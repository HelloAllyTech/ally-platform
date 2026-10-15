import { Children, isValidElement } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderBudgetState } from "@types";

// @constants reads off the @components barrel at module-eval time (see the
// BugHunter tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

// NOTE: mocking the design system away is what let a real Carbon contract
// violation ship. The banner rendered a <Button> INSIDE an InlineNotification,
// which Carbon forbids and throws on — but the mock below accepted children
// happily, so every test passed while the live page hit an error boundary.
// The mock now mirrors the real components' shape: the actionable variant takes
// its button as a PROP, so a child passed to it would go nowhere here too.
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: Object.assign(
    ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
    { rendersInteractive: true },
  ),
  InlineNotification: ({ title, subtitle, children }: any) => {
    // Carbon throws on INTERACTIVE children only — a plain <ul> of hints is a
    // legitimate child and is used elsewhere in this app. Mirroring the real
    // rule rather than a stricter one, so this mock cannot reject a valid use.
    const interactive = (node: any): boolean =>
      Children.toArray(node).some((child: any) => {
        if (!isValidElement(child)) return false;
        // Raw tags, and design-system components that render one — the real bug
        // passed a <Button>, whose type is a function, so a tag-name check alone
        // sails straight past it.
        if (["button", "a", "input", "select", "textarea"].includes(child.type as string))
          return true;
        if ((child.type as any)?.rendersInteractive) return true;
        return interactive((child.props as any)?.children);
      });
    if (interactive(children))
      throw new Error("InlineNotification must have no interactive child nodes");
    return (
      <div>
        <p>{title}</p>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </div>
    );
  },
  ActionableNotification: ({ title, subtitle, actionButtonLabel, onActionButtonClick }: any) => (
    <div>
      <p>{title}</p>
      {subtitle && <p>{subtitle}</p>}
      {actionButtonLabel && <button onClick={onActionButtonClick}>{actionButtonLabel}</button>}
    </div>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
  Tile: ({ children }: any) => <div>{children}</div>,
}));

// The feed, rail and panels are exercised by their own tests; what is under
// test here is the budget banner and what it does.
vi.mock("../BuildActivityFeed", () => ({ BuildActivityFeed: () => <div /> }));
vi.mock("../RunHistoryRail", () => ({ RunHistoryRail: () => <div /> }));
vi.mock("../RaiseBudgetDialog", () => ({
  RaiseBudgetDialog: ({ isOpen }: any) => (isOpen ? <div>raise-budget-dialog</div> : null),
}));

vi.mock("@hooks", () => ({
  useBuilderSocket: () => ({ connected: true, markSeen: () => undefined }),
}));

let budget: BuilderBudgetState | undefined;
const fetchEvents = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ events: [] }) });

vi.mock("@api", () => ({
  useGetBuilderRunsQuery: () => ({ data: [] }),
  useGetBuilderMilestonesQuery: () => ({ data: [] }),
  useGetBuilderPullRequestsQuery: () => ({ data: [] }),
  useMergeBuilderPullRequestMutation: () => [vi.fn(), { isLoading: false }],
  useGetBuilderPrFeedbackQuery: () => ({ data: [] }),
  useGetBuilderSettingsQuery: () => ({ data: undefined }),
  useResumeBuilderPullRequestAutomationMutation: () => [vi.fn(), { isLoading: false }],
  useGetBuilderSessionBudgetQuery: () => ({ data: budget, refetch: vi.fn() }),
  useLazyGetBuilderRunEventsQuery: () => [fetchEvents],
}));

// eslint-disable-next-line import/first
import { BuildView } from "../BuildView";

const over: BuilderBudgetState = {
  budgetUsd: 15,
  spentUsd: 16.7668,
  remainingUsd: 0,
  exceeded: true,
};

const renderView = () => render(<BuildView sessionId="session-1" status="BUILDING" />);

describe("BuildView budget banner", () => {
  beforeEach(() => {
    budget = undefined;
  });

  it("offers the raise once spend is past the ceiling", () => {
    budget = over;
    renderView();

    expect(screen.getByText("Spend is past the ceiling")).toBeTruthy();
    expect(screen.getByText(/Raise the ceiling to run anything more/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raise budget" })).toBeTruthy();
  });

  it("opens the raise dialog from the banner", () => {
    budget = over;
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));

    expect(screen.getByText("raise-budget-dialog")).toBeTruthy();
  });

  it("stays out of the way while the session is inside its budget", () => {
    budget = { ...over, spentUsd: 4, remainingUsd: 11, exceeded: false };
    renderView();

    expect(screen.queryByText("Spend is past the ceiling")).toBeNull();
  });

  /**
   * `exceeded` is a durable fact, not a live one: the ceiling is why the
   * session stopped, and the raise is the only way to restart it.
   */
  it("still offers the raise on a session stopped over its ceiling", () => {
    budget = over;
    render(<BuildView sessionId="session-1" status="FAILED" />);

    expect(screen.getByRole("button", { name: "Raise budget" })).toBeInTheDocument();
  });

  /** A raise cannot unblock a session that has nothing left to do. */
  it("stops offering it once the session is finished", () => {
    budget = over;
    render(<BuildView sessionId="session-1" status="COMPLETED" />);

    expect(screen.queryByRole("button", { name: "Raise budget" })).toBeNull();
  });
});
