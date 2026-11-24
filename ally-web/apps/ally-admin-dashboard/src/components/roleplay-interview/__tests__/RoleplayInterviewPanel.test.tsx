import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const mocks = vi.hoisted(() => ({
  session: {
    id: "s1",
    status: "PLAN_READY",
    brief: { learners: { who: "Teachers" }, mode: "learning" },
    stillNeeded: [] as string[],
    plan: null as any,
    planVersion: 0,
    scenarioId: null,
  },
  approve: vi.fn(),
}));

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));
vi.mock("@api", () => ({
  useOpenRoleplayInterviewMutation: () => [
    () => ({ unwrap: () => Promise.resolve(mocks.session) }),
  ],
  useGetRoleplayInterviewMutation: () => [
    () => ({ unwrap: () => Promise.resolve({ session: mocks.session, messages: [] }) }),
  ],
  useApproveRoleplayInterviewMutation: () => [mocks.approve, { isLoading: false }],
  useLinkRoleplayInterviewMutation: () => [vi.fn()],
  useAbandonRoleplayInterviewMutation: () => [vi.fn()],
}));
vi.mock("../../../hooks/useRoleplayInterviewStream", () => ({
  useRoleplayInterviewStream: () => ({
    messages: [],
    isStreaming: false,
    send: vi.fn(),
    stop: vi.fn(),
    hydrate: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("../../agent-chat", () => ({
  ChatMessage: () => null,
  AgentReceipt: () => null,
  ChatComposer: () => <div>composer</div>,
}));

// eslint-disable-next-line import/first
import { RoleplayInterviewPanel } from "../RoleplayInterviewPanel";

const plan = {
  version: 1,
  title: "Aarav: a quiet worry",
  characterSheet: { name: "Aarav", summary: "15", hides: "x", opensUpWhen: "y", speaks: "z" },
  moments: ["Mentions the notebook"],
  states: [{ name: "Guarded", guidelines: "Short answers" }],
  passCriteria: { helpful: ["Asks directly"], unhelpful: ["Lectures"], minScore: 50 },
  openingLine: "Leave me alone.",
  supports: { remindersEnabled: true },
};

beforeEach(() => {
  mocks.session.plan = null;
  mocks.session.status = "INTERVIEWING";
  mocks.approve.mockReset();
});

const renderPanel = async (onApproved = vi.fn()) => {
  await act(async () => {
    render(<RoleplayInterviewPanel onApproved={onApproved} />);
  });
  return onApproved;
};

describe("RoleplayInterviewPanel tabs", () => {
  const tabs = en.roleplayInterview.tabs;

  it("opens on Build (the chat) and shows the brief under Brief", async () => {
    await renderPanel();
    expect(screen.getByRole("tab", { name: tabs.build }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("composer")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tabs.brief) }));
    expect(screen.getByTestId("roleplay-brief")).toBeTruthy();
    expect(screen.getByText(tabs.noPlanYet)).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", async () => {
    await renderPanel();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByTestId("roleplay-brief")).toBeTruthy();
  });

  it("points from the chat to the plan, and approves from either tab", async () => {
    mocks.session.plan = plan;
    mocks.session.planVersion = 1;
    mocks.session.status = "PLAN_READY";
    mocks.approve.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          session: { ...mocks.session, status: "APPROVED" },
          generation: { mode: "learning" },
        }),
    });
    const onApproved = await renderPanel();
    expect(screen.getByTestId("plan-notice").textContent).toContain(plan.title);
    fireEvent.click(screen.getByText(tabs.reviewPlan));
    expect(screen.getByTestId("roleplay-plan")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText(en.roleplayInterview.plan.approve));
    });
    expect(mocks.approve).toHaveBeenCalledWith({ id: "s1", planVersion: 1 });
    expect(onApproved).toHaveBeenCalledWith({ mode: "learning" }, "s1");
  });
});
