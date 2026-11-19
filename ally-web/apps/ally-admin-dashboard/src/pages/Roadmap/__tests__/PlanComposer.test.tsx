import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { BuilderServerMessage } from "@types";

const mockSend = vi.fn();

vi.mock("../../../api/roadmapPlanning", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSendRoadmapPlanMessageMutation: () => [
    vi.fn((arg: unknown) => ({ unwrap: () => Promise.resolve(mockSend(arg)) })),
    { isLoading: false },
  ],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { PlanComposer, agentHasSpoken } from "../session/PlanComposer";

const copy = en.roadmapV2.planGate;
const item = (workPlan: boolean) => ({
  code: "OPP-9",
  sessionId: "s-9",
  can: { workPlan },
});
const reply = {
  id: "m1",
  seq: 2,
  role: "assistant",
  content: "Here is the brief.",
} as BuilderServerMessage;

describe("the planner's composer (audit rec 1)", () => {
  it("is absent unless the server says the caller works the plan", () => {
    const { container } = render(<PlanComposer item={item(false)} messages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to start the agent before it has said anything, with nothing typed", async () => {
    render(<PlanComposer item={item(true)} messages={[]} />);
    fireEvent.click(screen.getByRole("button", { name: copy.startAgent }));
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith({ code: "OPP-9", sessionId: "s-9", text: undefined }),
    );
  });

  it("sends the planner's words, which start the agent's next turn", async () => {
    mockSend.mockClear();
    render(<PlanComposer item={item(true)} messages={[reply]} />);
    expect(screen.queryByRole("button", { name: copy.startAgent })).toBeNull();
    const send = screen.getByRole("button", { name: copy.send });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(copy.composerPlaceholder), {
      target: { value: "Cover the mobile app too." },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith({
        code: "OPP-9",
        sessionId: "s-9",
        text: "Cover the mobile app too.",
      }),
    );
  });

  it("counts a running or question-only turn as the agent having spoken", () => {
    expect(agentHasSpoken([])).toBe(false);
    expect(
      agentHasSpoken([
        { ...reply, content: null, metadata: { streaming: true } } as BuilderServerMessage,
      ]),
    ).toBe(true);
  });
});
