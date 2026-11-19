import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type { AssistantSeatsView, MyPlan, PlanSeat, PublishUse } from "@api";

import { SeatsBlock } from "../../AssistantHome/sections/Seats";
import { ShareScreen } from "../../Onboarding/screens/Share";
import { compactCount, fullCount, levelOf, shortDay } from "../format";
import { planLimitMessage } from "../limits";
import { MyPlanBody, tokensLine } from "../MyPlan";

/**
 * CR1 Part C, the owner side: Plan and usage, Share → People's seats and publishing. Customers and
 * owners never see dollars (chunk-cr1 "Customers never see dollars"), so none of these screens may
 * draw a "$", whatever ally-be sends.
 */

const bar = (used: number, limit: number | null) => ({ used, limit, resetsOn: "2026-12-01" });

const seat = (over: Partial<PlanSeat>): PlanSeat => ({
  id: "s1",
  kind: "included",
  typeKey: "basic",
  typeName: "Basic",
  assigneeEmail: "meera@sunrise.example",
  startDate: "2026-11-01",
  nextRenewal: null,
  status: "active",
  messages: bar(120, 500),
  ...over,
});

const SEATS = [
  seat({ id: "s1" }),
  seat({ id: "s2", assigneeEmail: "ravi@sunrise.example", messages: bar(460, 500) }),
  seat({ id: "s3", assigneeEmail: null, messages: bar(0, 500) }),
  seat({
    id: "s4",
    kind: "extra",
    typeKey: "premium",
    typeName: "Premium",
    assigneeEmail: "asha@sunrise.example",
    nextRenewal: "2026-11-24",
    status: "expiring",
    messages: bar(900, 3000),
  }),
];

const PLAN_VIEW: MyPlan = {
  isCreator: true,
  tokens: { unlimited: false, left: 1_200_000, granted: 2_000_000, resetsOn: "2026-12-01" },
  plan: {
    key: "free",
    name: "Free",
    maxPublished: 3,
    published: 2,
    line: "Free · 2 of 3 assistants published",
    status: "active",
  },
  period: { start: "2026-11-01", end: "2026-12-01" },
  ownerRuns: bar(84, 100),
  assistants: [
    {
      chatbotId: "b1",
      name: "Sunrise Mind",
      status: "live",
      seats: SEATS,
      seatSummary: "3 included · 1 extra Premium",
      unassigned: 1,
      customers: bar(312, 1000),
    },
  ],
  alerts: [{ what: "Setup and checkup runs", percent: 84 }],
};

const SEATS_VIEW: AssistantSeatsView = {
  chatbotId: "b1",
  name: "Sunrise Mind",
  published: true,
  seatsRequired: true,
  seats: SEATS,
  seatSummary: "3 included · 1 extra Premium",
  unassigned: 1,
  customers: bar(312, 1000),
  people: [
    { email: "meera@sunrise.example", role: "owner", hasSeat: true },
    { email: "ravi@sunrise.example", role: "editor", hasSeat: true },
    { email: "asha@sunrise.example", role: "invited", hasSeat: true },
    { email: "kiran@sunrise.example", role: "invited", hasSeat: false },
  ],
};

const shareView = { draft: { access: { mode: "invite", emails: ["kiran@sunrise.example"] } } };

const noDollars = (container: HTMLElement) => expect(container.textContent).not.toContain("$");

describe("Plan and usage", () => {
  it("shows the plan line, tokens left, this month's runs, seats and the alert, with no dollars", () => {
    const { container } = render(
      <MemoryRouter>
        <MyPlanBody plan={PLAN_VIEW} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Free · 2 of 3 assistants published")).toBeTruthy();
    expect(screen.getByTestId("plan-tokens").textContent).toContain(
      "1.2M of 2M tokens left · resets 1 Dec",
    );
    expect(screen.getByTestId("plan-owner-runs").textContent).toContain("84 of 100");
    expect(screen.getByTestId("plan-customers").textContent).toContain("312 of 1,000");
    expect(screen.getByTestId("plan-alerts").textContent).toContain("84% used");
    expect(screen.getAllByTestId("seat-row")).toHaveLength(4);
    fireEvent.click(screen.getByTestId("plan-upgrade"));
    expect(screen.getByRole("note").textContent).toContain("ask your contact at Ally");
    noDollars(container);
  });

  it("says a user who never created an assistant has no plan, and still shows their tokens", () => {
    const { container } = render(
      <MemoryRouter>
        <MyPlanBody
          plan={{
            isCreator: false,
            tokens: { unlimited: true, left: 0, granted: 0, resetsOn: null },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("plan-not-creator")).toBeTruthy();
    expect(screen.getByTestId("plan-tokens").textContent).toContain("Unlimited tokens");
    expect(screen.queryByTestId("plan-assistants")).toBeNull();
    noDollars(container);
  });

  it("reads unlimited limits as Unlimited, with no bar", () => {
    render(
      <MemoryRouter>
        <MyPlanBody plan={{ ...PLAN_VIEW, ownerRuns: bar(40, null), alerts: [] }} />
      </MemoryRouter>,
    );
    const runs = screen.getByTestId("plan-owner-runs");
    expect(runs.textContent).toContain("Unlimited");
    expect(runs.querySelector('[role="progressbar"]')).toBeNull();
  });
});

describe("Share → People → Seats", () => {
  it("lets an owner give a free seat to someone without one, and move a seat", () => {
    const onAssign = vi.fn();
    const { container } = render(
      <SeatsBlock view={SEATS_VIEW} canManage busy={false} error={null} onAssign={onAssign} />,
    );
    expect(screen.getByTestId("seat-summary").textContent).toContain(
      "3 included · 1 extra Premium · 1 seat not given to anyone",
    );
    fireEvent.click(screen.getByTestId("give-seat"));
    expect(onAssign).toHaveBeenCalledWith("s3", "kiran@sunrise.example");
    fireEvent.change(screen.getByTestId("seat-assign-s1"), {
      target: { value: "kiran@sunrise.example" },
    });
    expect(onAssign).toHaveBeenLastCalledWith("s1", "kiran@sunrise.example");
    noDollars(container);
  });

  it("is read-only for editors and viewers", () => {
    render(
      <SeatsBlock
        view={SEATS_VIEW}
        canManage={false}
        busy={false}
        error={null}
        onAssign={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("give-seat")).toBeNull();
    expect(screen.queryByTestId("seat-assign-s1")).toBeNull();
  });

  it("says invited people need no seat on Ally's internal plan", () => {
    render(
      <SeatsBlock
        view={{ ...SEATS_VIEW, seatsRequired: false }}
        canManage
        busy={false}
        error={null}
        onAssign={vi.fn()}
      />,
    );
    expect(screen.getByTestId("seats-not-required")).toBeTruthy();
  });
});

describe("Publish", () => {
  const use = (over: Partial<PublishUse>): PublishUse => ({
    planName: "Free",
    maxPublished: 3,
    published: 2,
    wouldUse: 3,
    canPublish: true,
    message: null,
    ...over,
  });

  it('says "This uses 3 of your 3 assistants" before publishing', () => {
    const { container } = render(
      <ShareScreen
        view={shareView as never}
        publicAllowed={false}
        publishing={false}
        onPublish={vi.fn()}
        publishUse={use({})}
      />,
    );
    expect(screen.getByTestId("publish-use").textContent).toBe("This uses 3 of your 3 assistants.");
    noDollars(container);
  });

  it("shows the plan's refusal and switches publishing off when there is no room", () => {
    const onPublish = vi.fn();
    const { container } = render(
      <ShareScreen
        view={shareView as never}
        publicAllowed={false}
        publishing={false}
        onPublish={onPublish}
        publishUse={use({
          published: 3,
          wouldUse: 4,
          canPublish: false,
          message: "Free publishes up to 3 assistants. Ask Ally about Pro.",
        })}
      />,
    );
    expect(screen.getByTestId("publish-limit").textContent).toContain("Ask Ally about Pro");
    expect(screen.queryByTestId("publish-use")).toBeNull();
    const button = screen.getAllByRole("button").find(b => b.textContent?.includes("Publish"));
    expect(button?.hasAttribute("disabled")).toBe(true);
    noDollars(container);
  });

  it("says nothing on a plan with no publishing limit", () => {
    render(
      <ShareScreen
        view={shareView as never}
        publicAllowed={false}
        publishing={false}
        onPublish={vi.fn()}
        publishUse={use({ maxPublished: null })}
      />,
    );
    expect(screen.queryByTestId("publish-use")).toBeNull();
  });
});

describe("format and limits", () => {
  it("formats tokens compactly and counts exactly", () => {
    expect(compactCount(1_200_000)).toBe("1.2M");
    expect(compactCount(2_000_000)).toBe("2M");
    expect(compactCount(950_000)).toBe("950K");
    expect(compactCount(312)).toBe("312");
    expect(fullCount(1000)).toBe("1,000");
    expect(shortDay("2026-12-01")).toBe("1 Dec");
    expect(
      tokensLine({ unlimited: false, left: 1_200_000, granted: 2_000_000, resetsOn: null }),
    ).toBe("1.2M of 2M tokens left");
  });

  it("warns at 80% and is full at the limit", () => {
    expect(levelOf(79, 100)).toBe("ok");
    expect(levelOf(80, 100)).toBe("high");
    expect(levelOf(100, 100)).toBe("full");
    expect(levelOf(5000, null)).toBe("ok");
  });

  it("passes the plan's own refusal through, and nothing else", () => {
    const message = "Your tokens are used up. Ask Ally to add more.";
    expect(planLimitMessage({ status: 403, data: { errorCode: "TOKENS_USED_UP", message } })).toBe(
      message,
    );
    expect(planLimitMessage({ errorCode: "PLAN_OWNER_RUNS_USED_UP", message: "x" })).toBe("x");
    expect(planLimitMessage({ data: { errorCode: "other", message: "nope" } })).toBeNull();
    expect(planLimitMessage(undefined)).toBeNull();
  });
});
