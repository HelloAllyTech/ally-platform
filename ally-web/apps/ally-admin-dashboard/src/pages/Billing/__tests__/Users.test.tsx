import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TokenSummary } from "@api";

vi.mock("@api", () => ({
  useGetPlansCatalogueQuery: () => ({ data: { plans: [], seatTypes: [], renewalsDue: [] } }),
  useSetUserPlanMutation: () => [vi.fn()],
  useAddSeatsMutation: () => [vi.fn()],
  useRenewSeatMutation: () => [vi.fn()],
  useCancelSeatMutation: () => [vi.fn()],
  useChangeSeatTypeMutation: () => [vi.fn()],
  useGetUserPlanQuery: vi.fn(),
  useGetUserTokensQuery: vi.fn(),
  useAssignTokensMutation: () => [vi.fn()],
  useUpdateTokenGrantMutation: () => [vi.fn()],
  useRevokeTokenGrantMutation: () => [vi.fn()],
  useDeleteTokenGrantMutation: () => [vi.fn()],
  useSetUnlimitedTokensMutation: () => [vi.fn()],
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

import { TokensView } from "../Users/UserTokens";
import { UserPlanView } from "../Users/UserPlan";

const SUMMARY: TokenSummary = {
  hasAllowance: true,
  unlimited: false,
  left: 1_200_000,
  granted: 2_000_000,
  usedThisMonth: 800_000,
  overdraft: 0,
  resetsOn: "2026-12-01T00:00:00.000Z",
  grants: [
    {
      id: "g1",
      amount: 2_000_000,
      remaining: 1_200_000,
      used: 800_000,
      renewMonthly: true,
      renewDay: 1,
      nextRenewalAt: "2026-12-01T00:00:00.000Z",
      expiresAt: null,
      status: "active",
      note: "Starting allowance",
      createdAt: "2026-11-01T00:00:00.000Z",
    },
    {
      id: "g2",
      amount: 500_000,
      remaining: 500_000,
      used: 0,
      renewMonthly: false,
      renewDay: null,
      nextRenewalAt: null,
      expiresAt: null,
      status: "active",
      note: "Top-up",
      createdAt: "2026-11-10T00:00:00.000Z",
    },
  ],
  usage: {
    byAssistant: [{ chatbotId: "b1", name: "Sunrise Mind", tokens: 800_000, costUsd: 1.92 }],
    byKind: [{ kind: "customer_reply", tokens: 600_000, costUsd: 1.4 }],
  },
  history: [],
};

describe("Ally admin → a user → Tokens", () => {
  it("shows the balance, and offers Delete only on an allowance none of which is used", () => {
    render(
      <TokensView
        summary={SUMMARY}
        onUnlimited={vi.fn()}
        onAssign={vi.fn()}
        onUpdate={vi.fn()}
        onRevoke={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tokens-left")).toHaveTextContent("1,200,000");
    const deletes = screen.getAllByRole("button", { name: "Delete" });
    expect(deletes[0]).toBeDisabled();
    expect(deletes[1]).toBeEnabled();
    // What it cost Ally: super admins only see this screen.
    expect(screen.getByText("$1.92")).toBeVisible();
    expect(screen.getByText("Customer reply")).toBeVisible();
  });
});

describe("Ally admin → a user → Plan", () => {
  it("says only chatbot creators have a plan, and nothing else", () => {
    render(<UserPlanView plan={{ isCreator: false, tokens: null }} userId={9} name="Ravi" />);
    expect(screen.getByTestId("user-plan-not-creator")).toHaveTextContent(
      "Only chatbot creators have a plan.",
    );
    expect(screen.queryByTestId("user-plan")).toBeNull();
  });
});
