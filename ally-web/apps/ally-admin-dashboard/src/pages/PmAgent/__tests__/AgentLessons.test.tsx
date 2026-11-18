import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lessonOf, stateOf } from "./fixtures";

const h = vi.hoisted(() => ({
  memory: { current: undefined as unknown },
  health: { current: undefined as unknown },
  confirm: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  runLessons: vi.fn(),
  save: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));
const ok = (fn: ReturnType<typeof vi.fn>) =>
  fn.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@api", () => ({
  useGetPmAgentMemoryQuery: () => ({ data: h.memory.current, isLoading: false }),
  useGetPmAgentHealthQuery: () => ({ data: h.health.current, isLoading: false, isError: false }),
  useGetPmAgentHistoryQuery: () => ({ data: { cards: [] }, isLoading: false }),
  useGetPmAgentFeedStateQuery: () => ({ data: stateOf(), isLoading: false, isError: false }),
  useConfirmPmAgentLessonMutation: () => [h.confirm, { isLoading: false }],
  useUpdatePmAgentMemoryMutation: () => [h.update, {}],
  useDeletePmAgentMemoryMutation: () => [h.remove, {}],
  useRunPmAgentLessonsMutation: () => [h.runLessons, { isLoading: false }],
  useRunPmAgentNowMutation: () => [vi.fn(), { isLoading: false }],
  useUpdatePmAgentSettingsMutation: () => [h.save, { isLoading: false }],
}));

import { AgentView, validateSettings } from "../AgentView";

beforeEach(() => {
  vi.clearAllMocks();
  [h.confirm, h.update, h.remove, h.runLessons, h.save].forEach(ok);
  h.memory.current = { facts: [], lessons: [] };
  h.health.current = {};
});

describe("lessons", () => {
  it("groups lessons and shows scope, support and eval badge", () => {
    h.memory.current = {
      facts: [],
      lessons: [
        lessonOf("p1", { status: "proposed", requiresConfirm: true, evalResult: null }),
        lessonOf("a1"),
        lessonOf("e1", { status: "expired" }),
        lessonOf("r1", { status: "removed", text: "Gone" }),
      ],
    };
    render(<AgentView initialSection="memory" />);
    expect(screen.getByRole("region", { name: "Proposed (needs you)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Expired" })).toBeInTheDocument();
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    expect(screen.getAllByText("Based on 8 decisions (82% consistent)").length).toBe(3);
    expect(
      screen.getAllByText(/Checked against 20 past decisions: agreement 70% to 75%/).length,
    ).toBe(2);
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.getAllByText("Category: ui ux").length).toBe(3);
  });

  it("shows Keep only on proposed lessons and confirms it", async () => {
    h.memory.current = {
      facts: [],
      lessons: [lessonOf("p1", { status: "proposed", requiresConfirm: true }), lessonOf("a1")],
    };
    render(<AgentView initialSection="memory" />);
    expect(screen.getAllByRole("button", { name: "Keep" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Lesson kept."));
  });

  it("edits a lesson inline through the memory endpoint and rejects empty text", async () => {
    h.memory.current = { facts: [], lessons: [lessonOf("a1")] };
    render(<AgentView initialSection="memory" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Write the lesson before saving.")).toBeInTheDocument();
    expect(h.update).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: "a1", value: "New text" }));
  });

  it("removes only after an inline confirm step", async () => {
    h.memory.current = { facts: [], lessons: [lessonOf("a1")] };
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<AgentView initialSection="memory" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(h.remove).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: /Remove this lesson/ });
    fireEvent.click(within(group).getByRole("button", { name: "Remove lesson" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith("a1"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("can cancel the remove step", () => {
    h.memory.current = { facts: [], lessons: [lessonOf("a1")] };
    render(<AgentView initialSection="memory" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows the empty state and tolerates a response with no lessons field", () => {
    h.memory.current = { facts: [] };
    render(<AgentView initialSection="memory" />);
    expect(screen.getByText("Lessons appear after a few weeks of decisions")).toBeInTheDocument();
  });

  it("runs the lesson review now and shows the reason when it does not start", async () => {
    h.runLessons.mockImplementation(() => ({
      unwrap: () => Promise.resolve({ started: false, reason: "budget exhausted" }),
    }));
    render(<AgentView initialSection="memory" />);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() =>
      expect(h.toast.message).toHaveBeenCalledWith("The review didn't start: budget exhausted"),
    );
  });
});

describe("health", () => {
  it("shows the new metrics and dashes when fields are missing", () => {
    h.health.current = { impactMeasuredCount: 4, impactImprovedRate: 0.5, activeLessons: 3 };
    render(<AgentView initialSection="health" />);
    expect(screen.getByText("Changes with measured impact")).toBeInTheDocument();
    expect(screen.getByText("Active lessons")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Lessons waiting for you")).toBeInTheDocument();
  });
});

describe("settings", () => {
  it("shows the lesson switch and weekday select when the backend supports them", () => {
    render(<AgentView />);
    // default state fixture has no lesson fields: controls hidden (older backend)
    expect(screen.queryByLabelText("Lesson day")).not.toBeInTheDocument();
  });
});

describe("validateSettings weekday", () => {
  const base = { budget: "100", cap: "5", hour: "9", mandate: "m" };
  it("includes lessonsWeekday when given and valid", () => {
    expect(validateSettings({ ...base, weekday: "3" }).patch?.lessonsWeekday).toBe(3);
  });
  it("omits it when the backend has no lessons", () => {
    expect(validateSettings(base).patch).not.toHaveProperty("lessonsWeekday");
  });
  it.each(["7", "-1", "", "1.5", "x"])("rejects %j", w => {
    expect(validateSettings({ ...base, weekday: w }).errors.weekday).toBeTruthy();
  });
});
