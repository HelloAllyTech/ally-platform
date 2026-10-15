import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderBudgetState } from "@types";

/**
 * The budget banner on the real design system. BuildView.budget.test.tsx mocks
 * `@ally-ui-mono/ui-shared`, so it cannot see how Carbon's notification treats
 * focus — and Carbon's ActionableNotification, as an `alertdialog`, focuses its
 * own action button after every render and wraps focus back inside itself on
 * blur. BuildView re-renders on its own as it polls, so that pulled the admin's
 * focus to "Raise budget" over and over, out of whatever they were doing
 * elsewhere on the page.
 */

// @constants reads off the @components barrel at module-eval time.
vi.mock("@components", () => ({ cellTypes: {} }));

// Stands in for anything else on the page the admin might be using.
vi.mock("../BuildActivityFeed", () => ({
  BuildActivityFeed: () => <textarea aria-label="Somewhere else" />,
}));
vi.mock("../RunHistoryRail", () => ({ RunHistoryRail: () => <div /> }));
vi.mock("../RaiseBudgetDialog", () => ({
  RaiseBudgetDialog: ({ isOpen }: any) => (isOpen ? <div>raise-budget-dialog</div> : null),
}));

vi.mock("@hooks", () => ({
  useBuilderSocket: () => ({ connected: true, markSeen: () => undefined }),
}));

let budget: BuilderBudgetState | undefined;

vi.mock("@api", () => ({
  useGetBuilderRunsQuery: () => ({ data: [] }),
  useGetBuilderMilestonesQuery: () => ({ data: [] }),
  useGetBuilderPullRequestsQuery: () => ({ data: [] }),
  useMergeBuilderPullRequestMutation: () => [vi.fn(), { isLoading: false }],
  useGetBuilderSessionBudgetQuery: () => ({ data: budget, refetch: vi.fn() }),
  useLazyGetBuilderRunEventsQuery: () => [
    vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ events: [] }) }),
  ],
  useGetBuilderPrFeedbackQuery: () => ({ data: [] }),
  useGetBuilderSettingsQuery: () => ({ data: undefined }),
  useResumeBuilderPullRequestAutomationMutation: () => [vi.fn(), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { BuildView } from "../BuildView";

const overBudget = (): BuilderBudgetState => ({
  budgetUsd: 15,
  spentUsd: 16.7668,
  remainingUsd: 0,
  exceeded: true,
});

const renderView = () => render(<BuildView sessionId="session-1" status="BUILDING" />);

describe("BuildView budget banner on real Carbon — focus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    budget = overBudget();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the raise, and the action still opens the dialog", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Raise budget" }));
    expect(screen.getByText("raise-budget-dialog")).toBeInTheDocument();
  });

  it("leaves focus where the admin put it when the view re-renders", () => {
    const { rerender } = renderView();
    const elsewhere = screen.getByLabelText("Somewhere else");
    act(() => elsewhere.focus());
    expect(document.activeElement).toBe(elsewhere);

    // A poll re-renders the banner on its own; nothing the admin did.
    budget = { ...overBudget(), spentUsd: 17.1 };
    rerender(<BuildView sessionId="session-1" status="BUILDING" />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(document.activeElement).toBe(elsewhere);
  });

  it("does not take focus when it appears", () => {
    renderView();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Raise budget" }));
  });

  // The banner has no close button: it says what the server says, and goes when the spend does.
  // Escape inside it used to dismiss it anyway — and with focus pulled into it on every render,
  // any Escape on the page could hide the only way to raise the budget.
  it("is not dismissed by Escape", () => {
    renderView();
    const raise = screen.getByRole("button", { name: "Raise budget" });
    act(() => raise.focus());

    act(() => {
      fireEvent.keyDown(raise, { key: "Escape", code: "Escape" });
    });

    expect(screen.getByRole("button", { name: "Raise budget" })).toBeInTheDocument();
  });

  it("lets focus leave the banner", () => {
    renderView();
    const raise = screen.getByRole("button", { name: "Raise budget" });
    const elsewhere = screen.getByLabelText("Somewhere else");

    act(() => raise.focus());
    act(() => elsewhere.focus());

    expect(document.activeElement).toBe(elsewhere);
  });
});
