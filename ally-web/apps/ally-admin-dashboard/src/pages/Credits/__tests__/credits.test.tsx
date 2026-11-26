import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type { MyCredits } from "@api";

const h = vi.hoisted(() => ({
  grant: vi.fn(),
  cutover: vi.fn(),
  transfer: vi.fn(),
  accounts: [] as unknown[],
  account: undefined as unknown,
}));

vi.mock("@components/charts", () => ({
  SimpleBarChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="bar-chart" data-series={JSON.stringify(data)} />
  ),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetCreditAccountsQuery: () => ({ data: h.accounts, isLoading: false, isError: false }),
  useGetCreditAccountQuery: () => ({ data: h.account, isLoading: false, isError: false }),
  useGrantCreditsMutation: () => [h.grant, { isLoading: false }],
  useRunCreditsCutoverMutation: () => [h.cutover, { isLoading: false }],
  useTransferChatbotBudgetMutation: () => [h.transfer, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { money, parseDollars } from "../format";
// eslint-disable-next-line import/first
import { MyCreditsBody } from "../MyCredits";
// eslint-disable-next-line import/first
import { StaffCredits } from "../StaffCredits";

const ok = (value: unknown = {}) => ({ unwrap: () => Promise.resolve(value) });

const CREDITS: MyCredits = {
  accountId: "a1",
  status: "active",
  grantedUsd: 20,
  usedUsd: 6.5,
  builderSpentUsd: 4,
  customerSpentUsd: 2.5,
  setAsideUsd: 4,
  reservedUsd: 0,
  freeBalanceUsd: 12,
  reserveUsd: 5,
  budgets: [
    {
      chatbotId: "b1",
      name: "Sunny",
      setAsideUsd: 4,
      spentUsd: 2.5,
      remainingUsd: 1.5,
      archived: false,
    },
  ],
  spendByTask: [{ task: "customer_reply", costUsd: 2.5 }],
  spendByChatbot: [{ chatbotId: "b1", name: "Sunny", costUsd: 2.5 }],
  spendByDay: [{ day: "2026-11-20", costUsd: 2.5 }],
  grants: [
    {
      id: "g1",
      kind: "grant",
      amountUsd: 20,
      note: "Pilot",
      at: "2026-11-01T00:00:00Z",
      grantedBy: null,
    },
  ],
  pausedJobs: [],
};

const renderBody = (credits: MyCredits) =>
  render(
    <MemoryRouter>
      <MyCreditsBody credits={credits} />
    </MemoryRouter>,
  );

beforeEach(() => {
  [h.grant, h.cutover, h.transfer].forEach(fn => fn.mockReset());
});

describe("Credits page", () => {
  it("shows granted, used, free balance and set aside, spend charts and the grant history", () => {
    renderBody(CREDITS);
    expect(screen.getByTestId("credits-granted")).toHaveTextContent("$20.00");
    expect(screen.getByTestId("credits-used")).toHaveTextContent("$6.50");
    expect(screen.getByTestId("credits-free")).toHaveTextContent("$12.00");
    expect(screen.getByTestId("credits-set-aside")).toHaveTextContent("$4.00");
    expect(screen.getAllByTestId("bar-chart")).toHaveLength(3);
    expect(screen.getByTestId("credits-spend-task")).toHaveTextContent("By kind of work");
    expect(screen.getByTestId("credits-grant-row")).toHaveTextContent("Pilot");
    expect(screen.getByTestId("credits-budget-row")).toHaveTextContent("Sunny");
    expect(screen.queryByTestId("credits-low")).toBeNull();
    expect(screen.queryByTestId("credits-paused")).toBeNull();
  });

  it("offers 'Contact Ally for more credits', and asks them to reach their Ally contact when pressed", () => {
    renderBody(CREDITS);
    expect(screen.queryByTestId("credits-contact-message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Contact Ally for more credits" }));
    expect(screen.getByRole("status")).toHaveTextContent("reach out to your contact at Ally");
    expect(screen.queryByRole("link", { name: "Contact Ally for more credits" })).toBeNull();
  });

  it("warns when the free balance is under the reserve and when it is used up", () => {
    const { unmount } = renderBody({ ...CREDITS, freeBalanceUsd: 3 });
    expect(screen.getByTestId("credits-low")).toHaveTextContent("Your free balance is low");
    unmount();
    renderBody({ ...CREDITS, freeBalanceUsd: 0 });
    expect(screen.getByTestId("credits-low")).toHaveTextContent("used up");
  });

  it("lists paused jobs and says they carry on by themselves", () => {
    renderBody({
      ...CREDITS,
      pausedJobs: [
        {
          kind: "site_reading",
          subjectId: "d1",
          reason: "no_credits",
          since: "2026-11-20T00:00:00Z",
          batches: 1,
        },
      ],
    });
    expect(screen.getByTestId("credits-paused")).toHaveTextContent("Reading your website");
    expect(screen.getByTestId("credits-paused")).toHaveTextContent("nothing is lost");
  });

  it("has no account yet: says so, charts nothing, shows no low-balance warning", () => {
    renderBody({
      ...CREDITS,
      accountId: null,
      status: "none",
      grantedUsd: 0,
      freeBalanceUsd: 0,
      spendByTask: [],
      spendByChatbot: [],
      spendByDay: [],
      budgets: [],
      grants: [],
    });
    expect(screen.getByTestId("credits-none")).toBeInTheDocument();
    expect(screen.queryByTestId("credits-low")).toBeNull();
    expect(screen.getByTestId("credits-spend-empty")).toBeInTheDocument();
  });

  it("never shows a per-customer breakdown", () => {
    renderBody(CREDITS);
    expect(document.body.textContent).not.toMatch(/per (person|user|customer)/i);
  });
});

describe("money helpers", () => {
  it("formats dollars and parses inputs", () => {
    expect(money(0.0043)).toBe("$0.0043");
    expect(money(1234.5)).toBe("$1,234.50");
    expect(parseDollars(" $2.50 ")).toBe(2.5);
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("abc")).toBeNaN();
  });
});

describe("Ally admin credits", () => {
  beforeEach(() => {
    h.accounts = [
      {
        accountId: "a1",
        ownerUserId: 7,
        name: "Asha",
        email: "asha@clinic.test",
        status: "active",
        grantedUsd: 20,
        setAsideUsd: 4,
        builderSpentUsd: 1,
        freeBalanceUsd: 15,
      },
      {
        accountId: "a2",
        ownerUserId: 8,
        name: "Ravi",
        email: "ravi@clinic.test",
        status: "active",
        grantedUsd: 10,
        setAsideUsd: 0,
        builderSpentUsd: 0,
        freeBalanceUsd: 10,
      },
    ];
    h.account = { ...CREDITS, ownerUserId: 7 };
  });

  it("lists accounts, filters them, and opens a ledger", () => {
    render(<StaffCredits />);
    expect(screen.getAllByTestId("staff-account-row")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search by name or email"), {
      target: { value: "ravi" },
    });
    expect(screen.getAllByTestId("staff-account-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open ledger" }));
    expect(screen.getByTestId("staff-ledger")).toBeInTheDocument();
    expect(screen.getByTestId("staff-ledger-free")).toHaveTextContent("$12.00");
  });

  it("grants credits with a note, and refuses a grant without one or a negative grant", async () => {
    h.grant.mockReturnValue(ok());
    render(<StaffCredits />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open ledger" })[0]);
    const amount = screen.getByLabelText(/Amount in dollars/);
    fireEvent.change(amount, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("staff-grant-message")).toHaveTextContent("A note is required.");
    fireEvent.change(amount, { target: { value: "-5" } });
    fireEvent.change(screen.getByLabelText("Note (required)"), { target: { value: "Pilot" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("staff-grant-message")).toHaveTextContent("above $0");
    expect(h.grant).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(h.grant).toHaveBeenCalledWith({
        accountId: "a1",
        amountUsd: 10,
        kind: "grant",
        note: "Pilot",
      }),
    );
  });

  it("grants to someone with no account by their sign-in email, then opens their ledger", async () => {
    h.grant.mockReturnValue(ok({ accountId: "a9" }));
    render(<StaffCredits />);
    const card = screen.getByTestId("staff-new-person");
    fireEvent.click(screen.getByRole("button", { name: "Grant credits" }));
    expect(screen.getByTestId("staff-new-person-error")).toHaveTextContent("sign in with");
    fireEvent.change(screen.getByLabelText("Their sign-in email"), {
      target: { value: " new@clinic.test " },
    });
    fireEvent.change(card.querySelector("input[inputmode=decimal]") as HTMLInputElement, {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant credits" }));
    expect(screen.getByTestId("staff-new-person-error")).toHaveTextContent("A note is required.");
    expect(h.grant).not.toHaveBeenCalled();
    fireEvent.change(card.querySelectorAll("input")[2], { target: { value: "Pilot" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant credits" }));
    await waitFor(() =>
      expect(h.grant).toHaveBeenCalledWith({
        email: "new@clinic.test",
        amountUsd: 10,
        kind: "grant",
        note: "Pilot",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("staff-ledger")).toBeInTheDocument());
  });

  it("says why when no one signs in with that email", async () => {
    h.grant.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          data: {
            message: "No one signs in with that email. Check it, or create their login first.",
          },
        }),
    });
    render(<StaffCredits />);
    const card = screen.getByTestId("staff-new-person");
    const inputs = card.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "nobody@clinic.test" } });
    fireEvent.change(inputs[1], { target: { value: "5" } });
    fireEvent.change(inputs[2], { target: { value: "Pilot" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant credits" }));
    await waitFor(() =>
      expect(screen.getByTestId("staff-new-person-error")).toHaveTextContent("No one signs in"),
    );
  });

  it("moves a budget to another builder", async () => {
    h.transfer.mockReturnValue(ok());
    render(<StaffCredits />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open ledger" })[0]);
    fireEvent.change(screen.getByLabelText("To builder (user id)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Move budget" }));
    await waitFor(() => expect(h.transfer).toHaveBeenCalledWith({ chatbotId: "b1", toUserId: 9 }));
  });

  it("runs the cutover dry run first and shows its report; the real run needs a dry run", async () => {
    h.cutover.mockReturnValue(
      ok({
        dryRun: true,
        startingCreditsUsd: 20,
        startingBudgetUsd: 2,
        builders: [],
        budgets: [{ chatbotId: "c9", userId: 1, outcome: "skipped", reason: "no credits" }],
        totals: { buildersGranted: 3, budgetsSet: 2, skipped: 1, grantedUsd: 60 },
      }),
    );
    render(<StaffCredits />);
    expect(screen.getByRole("button", { name: "Run the cutover" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await screen.findByTestId("staff-cutover-report");
    expect(h.cutover).toHaveBeenCalledWith({ dryRun: true });
    const report = screen.getByTestId("staff-cutover-report");
    expect(report).toHaveTextContent("Dry run (nothing changed)");
    expect(report).toHaveTextContent("$60.00");
    expect(report).toHaveTextContent("no credits");
    expect(screen.getByRole("button", { name: "Run the cutover" })).toBeEnabled();
  });
});
