import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CostOverview } from "@api";

vi.mock("@api", () => ({
  useGetAssistantCostQuery: vi.fn(),
  useGetCostBreakdownQuery: vi.fn(),
}));
// The real constants barrel reaches the store; the drill-down only needs the assistant's route.
vi.mock("@constants", () => ({ ROUTES: { CHATBOT_DETAIL: "/assistants/:botId" } }));

import { inboxLinkFor } from "../Costs/CostBreakdown";
import { AlertsBanner, CostTotals, PerCustomer } from "../Costs/CostTotals";

const OVERVIEW: CostOverview = {
  today: 3.42,
  week: 18.9,
  month: 61.25,
  whatsappMonth: 4.1,
  fixedMonth: 180,
  otherProductsMonth: 22.5,
  monthWithFixed: 263.75,
  unpricedEventsMonth: 0,
  customerConversations: 312,
  customerMessages: 1480,
  costPerConversation: 0.1963,
  costPerMessage: 0.0414,
  settings: { dailyBudget: 20, conversationAlert: 0.5, spikeMultiplier: 5, spikeMin: 1 },
  alerts: [],
};

describe("Ally admin → Costs", () => {
  it("shows today, this week, this month, the month all in and WhatsApp on its own", () => {
    render(<CostTotals overview={OVERVIEW} />);
    expect(screen.getByTestId("cost-today")).toHaveTextContent("$3.42");
    expect(screen.getByTestId("cost-week")).toHaveTextContent("$18.90");
    expect(screen.getByTestId("cost-month")).toHaveTextContent("$61.25");
    expect(screen.getByTestId("cost-month-all-in")).toHaveTextContent("$263.75");
    expect(screen.getByTestId("cost-month-all-in")).toHaveTextContent("$180.00");
    expect(screen.getByTestId("cost-whatsapp")).toHaveTextContent("$4.10");
  });

  it("says the totals are low when a model had no price", () => {
    render(<CostTotals overview={{ ...OVERVIEW, unpricedEventsMonth: 7 }} />);
    expect(screen.getByText(/7 calls this month used a model with no price/)).toBeVisible();
  });

  it("shows cost per conversation and per customer message", () => {
    render(<PerCustomer overview={OVERVIEW} />);
    expect(screen.getByText("$0.1963")).toBeVisible();
    expect(screen.getByText("$0.0414")).toBeVisible();
  });

  it("lists alerts with the server's message", () => {
    render(
      <AlertsBanner
        alerts={[
          {
            kind: "daily_budget",
            subjectKey: "day",
            day: "2026-11-18",
            detail: { message: "Yesterday cost $24.10, over the $20 budget." },
            createdAt: "2026-11-18T23:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("Over the daily budget")).toBeVisible();
    expect(screen.getByText("Yesterday cost $24.10, over the $20 budget.")).toBeVisible();
  });

  it("links a conversation to its assistant's Inbox", () => {
    expect(inboxLinkFor("bot-1", "conv 2")).toBe(
      "/assistants/bot-1?section=conversations&conversation=conv%202",
    );
  });
});
