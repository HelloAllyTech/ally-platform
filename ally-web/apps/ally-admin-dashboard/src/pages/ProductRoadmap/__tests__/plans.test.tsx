import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  plans: [] as any[],
  queue: [] as any[],
  notifications: [] as any[],
  startPlan: vi.fn(),
  takeOn: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@ally-ui-mono/ui-shared", () => ({ SkeletonText: () => <div>loading</div> }));
vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title, subtitle }: any) => (
    <div>
      {title} {subtitle}
    </div>
  ),
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "p", SECONDARY: "s", TEXT: "t", DESTRUCTIVE: "d" },
}));
vi.mock("@api", () => ({
  useGetMyPlansQuery: () => ({ data: state.plans, isLoading: false }),
  useGetPlanNotificationsQuery: () => ({ data: state.notifications }),
  useMarkPlanNotificationsReadMutation: () => [vi.fn()],
  useStartPlanMutation: () => [state.startPlan, { isLoading: false }],
  useGetPlanQueueQuery: () => ({ data: state.queue, isLoading: false }),
  useTakeOnPlanMutation: () => [state.takeOn, { isLoading: false }],
}));

import { LeadQueueTab } from "../plans/LeadQueueTab";
import { MyPlansTab } from "../plans/MyPlansTab";
import { PlanProgress } from "../plans/PlanProgress";
import { errorMessage, formatUsd } from "../plans/planLabels";

describe("MyPlansTab", () => {
  it("explains that ideas are private until filed when there are none", () => {
    state.plans = [];
    render(<MyPlansTab canFile onOpen={vi.fn()} />);
    expect(screen.getByText(/Only you can see them until you file/)).toBeInTheDocument();
  });

  it("parks an idea without opening the copilot", async () => {
    state.plans = [];
    state.startPlan.mockReturnValue({ unwrap: () => Promise.resolve({ id: "p1" }) });
    const onOpen = vi.fn();
    render(<MyPlansTab canFile onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("New idea"), { target: { value: "Learners drop off" } });
    fireEvent.click(screen.getByText("Park it"));
    await Promise.resolve();
    expect(state.startPlan).toHaveBeenCalledWith({ text: "Learners drop off", park: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hides the new-idea box from someone who cannot file", () => {
    render(<MyPlansTab canFile={false} onOpen={vi.fn()} />);
    expect(screen.queryByText("Park it")).not.toBeInTheDocument();
  });

  it("lists private ideas and filed plans separately", () => {
    state.plans = [
      {
        id: "a",
        title: "Private one",
        private: true,
        parked: true,
        stage: "idea",
        archivedAt: null,
      },
      {
        id: "b",
        title: "Filed one",
        private: false,
        parked: false,
        stage: "prd",
        archivedAt: null,
      },
    ];
    render(<MyPlansTab canFile onOpen={vi.fn()} />);
    expect(screen.getByText("Parked")).toBeInTheDocument();
    expect(screen.getByText("Plans you filed")).toBeInTheDocument();
    expect(screen.getByText("Writing the PRD")).toBeInTheDocument();
  });
});

describe("LeadQueueTab", () => {
  it("offers Take this on, or a close review when one waits on a second Lead", () => {
    state.queue = [
      { id: "q1", title: "Open one", votes: 3, filedAt: null, awaitingCloseConfirmation: false },
      { id: "q2", title: "Closing one", votes: 30, filedAt: null, awaitingCloseConfirmation: true },
    ];
    render(<LeadQueueTab onOpen={vi.fn()} />);
    expect(screen.getByText("Take this on")).toBeInTheDocument();
    expect(screen.getByText("Review close")).toBeInTheDocument();
    expect(screen.getByText(/close waiting for a second Lead/)).toBeInTheDocument();
  });

  it("says plainly when nothing needs a lead", () => {
    state.queue = [];
    render(<LeadQueueTab onOpen={vi.fn()} />);
    expect(screen.getByText(/Nothing needs a lead/)).toBeInTheDocument();
  });
});

describe("plan helpers", () => {
  it("names the stage in words, never by colour alone", () => {
    render(<PlanProgress stage="measuring" caption="Lead: you" />);
    expect(screen.getByText("Measuring · Lead: you")).toBeInTheDocument();
  });

  it("shows the server's refusal, or a plain fallback", () => {
    expect(errorMessage({ data: { message: "Only this plan’s lead can do that." } }, "x")).toBe(
      "Only this plan’s lead can do that.",
    );
    expect(errorMessage(new Error("boom"), "Could not save.")).toBe("Could not save.");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});
