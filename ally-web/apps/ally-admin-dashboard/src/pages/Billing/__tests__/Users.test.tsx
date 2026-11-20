import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SpendSummary } from "@api";

vi.mock("@api", () => ({
  useGetPlansCatalogueQuery: () => ({ data: { plans: [], seatTypes: [], renewalsDue: [] } }),
  useSetUserPlanMutation: () => [vi.fn()],
  useAddSeatsMutation: () => [vi.fn()],
  useRenewSeatMutation: () => [vi.fn()],
  useCancelSeatMutation: () => [vi.fn()],
  useChangeSeatTypeMutation: () => [vi.fn()],
  useGetUserPlanQuery: vi.fn(),
  useGetUserSpendQuery: vi.fn(),
  useSetUserSpendCapMutation: () => [vi.fn()],
}));
// Sidesteps the @constants ↔ @components circular import under vitest.
vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ToggleSwitch: ({ enabled, label }: any) => (
    <button role="switch" aria-checked={enabled} aria-label={label} />
  ),
  ActionConfirmationPopup: () => null,
}));
vi.mock("@assets", () => ({ DoubleArrowRight: () => null }));

import { SpendView } from "../Users/UserSpend";
import { UserPlanView } from "../Users/UserPlan";

const SUMMARY: SpendSummary = {
  isCreator: true,
  planName: "Pro",
  usedUsd: 31.5,
  capUsd: 40,
  capSource: "plan",
  planCapUsd: 40,
  resetsOn: "2026-12-01",
  usage: {
    byAssistant: [{ chatbotId: "b1", name: "Sunrise Mind", tokens: 800_000, costUsd: 1.92 }],
    byKind: [{ kind: "customer_reply", tokens: 600_000, costUsd: 1.4 }],
  },
  history: [],
};

const view = (summary: SpendSummary) =>
  render(
    <SpendView
      summary={summary}
      ownCap=""
      onOwnCap={vi.fn()}
      onSaveCap={vi.fn()}
      onUsePlan={vi.fn()}
      onNeverCapped={vi.fn()}
    />,
  );

describe("Ally admin → a user → Spend", () => {
  it("shows the period's spend against the plan's cap, in dollars, and where it went", () => {
    view(SUMMARY);
    expect(screen.getByTestId("spend-used")).toHaveTextContent("$31.50");
    expect(screen.getByTestId("spend-cap")).toHaveTextContent("$40.00");
    expect(screen.getByText("Pro plan")).toBeVisible();
    expect(screen.queryByTestId("spend-at-cap")).toBeNull();
    // Going back to the plan's cap is only offered when they have their own.
    expect(screen.queryByRole("button", { name: "Use the plan's cap" })).toBeNull();
    expect(screen.getByText("$1.92")).toBeVisible();
    expect(screen.getByText("Customer reply")).toBeVisible();
  });

  it("says so at the cap, and offers the plan's cap back to someone with their own", () => {
    view({ ...SUMMARY, usedUsd: 60, capUsd: 60, capSource: "own" });
    expect(screen.getByTestId("spend-at-cap")).toHaveTextContent("At the cap");
    expect(screen.getByText("Their own")).toBeVisible();
    expect(screen.getByRole("button", { name: "Use the plan's cap" })).toBeEnabled();
  });

  it("reads never capped and no cap in words", () => {
    const { unmount } = view({ ...SUMMARY, capUsd: null, capSource: "off" });
    expect(screen.getByTestId("spend-cap")).toHaveTextContent("Never capped");
    expect(screen.getByRole("switch", { name: "Never capped" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    unmount();
    view({ ...SUMMARY, capUsd: null, capSource: "none", planCapUsd: null });
    expect(screen.getByTestId("spend-cap")).toHaveTextContent("No cap");
    expect(screen.queryByTestId("spend-at-cap")).toBeNull();
  });

  it("offers no cap controls for someone who isn't a creator", () => {
    view({ ...SUMMARY, isCreator: false, capUsd: null, capSource: "none" });
    expect(screen.getByText("Only chatbot creators have a cost cap.")).toBeVisible();
    expect(screen.queryByTestId("spend-cap-save")).toBeNull();
  });
});

describe("Ally admin → a user → Plan", () => {
  it("says only chatbot creators have a plan, and nothing else", () => {
    render(<UserPlanView plan={{ isCreator: false }} userId={9} name="Ravi" />);
    expect(screen.getByTestId("user-plan-not-creator")).toHaveTextContent(
      "Only chatbot creators have a plan.",
    );
    expect(screen.queryByTestId("user-plan")).toBeNull();
  });
});
