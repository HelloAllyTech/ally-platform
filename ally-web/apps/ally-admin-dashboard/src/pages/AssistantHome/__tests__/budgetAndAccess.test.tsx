import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@constants";

const h = vi.hoisted(() => ({
  budget: undefined as unknown,
  entries: [] as unknown[],
  topUp: vi.fn(),
  setBudget: vi.fn(),
  limits: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetChatbotBudgetQuery: () => ({ data: h.budget, isError: false }),
  useTopUpChatbotBudgetMutation: () => [h.topUp],
  useSetChatbotBudgetMutation: () => [h.setBudget],
  useSetChatbotUserLimitsMutation: () => [h.limits],
  useGetAccessListQuery: () => ({ data: h.entries, isError: false }),
  useAddAccessEntriesMutation: () => [h.add, { isLoading: false }],
  useRemoveAccessEntryMutation: () => [h.remove],
  useUpdateChatbotMutation: () => [h.update],
}));

// eslint-disable-next-line import/first
import { BudgetLimits } from "../sections/BudgetLimits";
// eslint-disable-next-line import/first
import { WhoMayChat, normalisePhone, parseEntries } from "../sections/WhoMayChat";

const ok = (value: unknown = {}) => ({ unwrap: () => Promise.resolve(value) });
const props = (over: Record<string, unknown> = {}) =>
  ({
    bot: { id: "b1", accessMode: "listed", connectors: [] },
    home: {},
    canEdit: true,
    canManage: true,
    go: vi.fn(),
    ...over,
  }) as never;

const BUDGET = {
  chatbotId: "b1",
  hasBudget: true,
  setAsideUsd: 4,
  spentUsd: 1,
  reservedUsd: 0,
  remainingUsd: 3,
  freeBalanceUsd: 8,
  reserveUsd: 5,
  userLimits: { dailyUsd: 1, weeklyUsd: null, monthlyUsd: 10 },
};

beforeEach(() => {
  Object.values(h).forEach(
    v => typeof v === "function" && (v as ReturnType<typeof vi.fn>).mockReset?.(),
  );
  h.budget = BUDGET;
  h.entries = [];
});

describe("Budget and limits", () => {
  it("shows what is set aside, used, left and the free balance", () => {
    render(<BudgetLimits {...props()} />);
    expect(screen.getByTestId("budget-set-aside")).toHaveTextContent("$4.00");
    expect(screen.getByTestId("budget-used")).toHaveTextContent("$1.00");
    expect(screen.getByTestId("budget-left")).toHaveTextContent("$3.00");
    expect(screen.getByTestId("budget-free")).toHaveTextContent("$8.00");
    expect(screen.queryByTestId("budget-none")).toBeNull();
    expect(screen.queryByTestId("budget-out")).toBeNull();
  });

  it("TF1 round 2, N-12: shows what replies in progress hold, so the line adds up", () => {
    h.budget = { ...BUDGET, setAsideUsd: 2, spentUsd: 0.05, reservedUsd: 0.29, remainingUsd: 1.66 };
    render(<BudgetLimits {...props()} />);
    expect(screen.getByText("Held for replies in progress")).toBeInTheDocument();
    expect(screen.getByTestId("budget-held")).toHaveTextContent("$0.29");
    expect(screen.getByTestId("budget-left")).toHaveTextContent("$1.66");
  });

  it("shows no held line when nothing is held", () => {
    h.budget = { ...BUDGET, reservedUsd: 0 };
    render(<BudgetLimits {...props()} />);
    expect(screen.queryByTestId("budget-held")).toBeNull();
  });

  it("explains 'no budget yet' with the fixed crisis notification", () => {
    h.budget = {
      ...BUDGET,
      hasBudget: false,
      setAsideUsd: 0,
      remainingUsd: 0,
      freeBalanceUsd: null,
    };
    render(<BudgetLimits {...props()} />);
    expect(screen.getByTestId("budget-none")).toHaveTextContent(
      "fixed notification with crisis information",
    );
  });

  it("says 'out of credits' when the budget is used up", () => {
    h.budget = { ...BUDGET, spentUsd: 4, remainingUsd: 0 };
    render(<BudgetLimits {...props()} />);
    expect(screen.getByTestId("budget-out")).toHaveTextContent("Out of credits");
  });

  it("tops up from the free balance and warns when that leaves under the reserve", async () => {
    h.topUp.mockReturnValue(ok({ ...BUDGET, clamped: false, warning: null }));
    render(<BudgetLimits {...props()} />);
    fireEvent.change(screen.getByLabelText("Add from your free balance"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    await waitFor(() => expect(h.topUp).toHaveBeenCalledWith({ id: "b1", amountUsd: 5 }));
    expect(await screen.findByTestId("budget-note")).toHaveTextContent("under $5.00");
  });

  it("refuses a top-up bigger than the free balance, without calling the server", () => {
    render(<BudgetLimits {...props()} />);
    fireEvent.change(screen.getByLabelText("Add from your free balance"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
    expect(screen.getByTestId("budget-note")).toHaveTextContent("only have $8.00");
    expect(h.topUp).not.toHaveBeenCalled();
  });

  it("saves per-person limits, empty meaning none", async () => {
    h.limits.mockReturnValue(ok());
    render(<BudgetLimits {...props()} />);
    fireEvent.change(screen.getByLabelText("Per day ($)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Per week ($)"), { target: { value: "3.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() =>
      expect(h.limits).toHaveBeenCalledWith({
        id: "b1",
        dailyUsd: null,
        weeklyUsd: 3.5,
        monthlyUsd: 10,
      }),
    );
  });

  it("hides the controls from someone who can't manage", () => {
    render(<BudgetLimits {...props({ canManage: false })} />);
    expect(screen.queryByRole("button", { name: "Add credits" })).toBeNull();
    expect(screen.getByTestId("budget-current")).toBeInTheDocument();
  });
});

describe("Who may chat", () => {
  it("parses phones to E.164 and emails to lower case, and names the first bad entry", () => {
    expect(normalisePhone("+91 98123-45678")).toBe("+919812345678");
    expect(normalisePhone("12")).toBeNull();
    expect(parseEntries("+91 98123 45678, Asha@Example.com\n+44 20 7946 0958")).toEqual({
      entries: [
        { kind: "phone", value: "+919812345678" },
        { kind: "email", value: "asha@example.com" },
        { kind: "phone", value: "+442079460958" },
      ],
      bad: null,
    });
    expect(parseEntries("asha@example.com, nonsense").bad).toBe("nonsense");
  });

  it("is invite only, says an empty list means nobody can chat, and adds entries", async () => {
    h.add.mockReturnValue(ok({ added: 2, skipped: 1 }));
    render(<WhoMayChat {...props()} />);
    expect(screen.getByLabelText(/Invite only/)).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Anyone/ })).toBeNull();
    expect(screen.getByTestId("access-empty")).toHaveTextContent("nobody can chat");
    fireEvent.change(screen.getByLabelText("Add phone numbers or emails"), {
      target: { value: "+91 98123 45678, asha@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
    await waitFor(() =>
      expect(h.add).toHaveBeenCalledWith({
        id: "b1",
        entries: [
          { kind: "phone", value: "+919812345678" },
          { kind: "email", value: "asha@example.com" },
        ],
      }),
    );
    expect(await screen.findByTestId("access-message")).toHaveTextContent("Added 2, 1 already");
  });

  it("rejects a bad entry before calling the server", () => {
    render(<WhoMayChat {...props()} />);
    fireEvent.change(screen.getByLabelText("Add phone numbers or emails"), {
      target: { value: "nonsense" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
    expect(screen.getByTestId("access-message")).toHaveTextContent('"nonsense" is not');
    expect(h.add).not.toHaveBeenCalled();
  });

  it("lists entries, notes phone-only invitees need the chatbot's own WhatsApp number, and removes after a confirm", async () => {
    h.remove.mockReturnValue(ok());
    h.entries = [
      { id: "e1", chatbotId: "b1", kind: "phone", value: "+919812345678" },
      { id: "e2", chatbotId: "b1", kind: "email", value: "asha@example.com", everMatched: false },
    ];
    render(<WhoMayChat {...props()} />);
    expect(screen.getAllByTestId("access-entry")).toHaveLength(2);
    expect(screen.getByTestId("access-whatsapp-note")).toHaveTextContent("own WhatsApp number");
    expect(screen.getByText("Invited")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove +919812345678" }));
    // Nobody goes on one click: a Remove / Cancel asks first.
    expect(h.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove +919812345678" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith({ id: "b1", entryId: "e1" }));
  });

  it("is read-only for a viewer", () => {
    h.entries = [{ id: "e1", chatbotId: "b1", kind: "email", value: "asha@example.com" }];
    render(<WhoMayChat {...props({ canEdit: false })} />);
    expect(screen.queryByRole("button", { name: "Add to list" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});
