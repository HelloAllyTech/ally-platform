import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseCopilotEvent } from "@types";

import { useCourseCopilotSocket } from "../useCourseCopilotSocket";

let socketOptions: any;
const emit = vi.fn();
vi.mock("../useAllySocket", () => ({
  useAllySocket: (options: unknown) => {
    socketOptions = options;
    return { emit };
  },
}));

const event = (seq: number, type: CourseCopilotEvent["type"] = "job_done"): CourseCopilotEvent => ({
  seq,
  type,
  payload: {},
  createdAt: new Date(0).toISOString(),
});

afterEach(() => {
  socketOptions = undefined;
  vi.clearAllMocks();
});

describe("useCourseCopilotSocket", () => {
  it("connects to the course-copilot namespace with a label, and only with a session", () => {
    const { rerender } = renderHook(
      ({ sessionId }) =>
        useCourseCopilotSocket({ sessionId, onEvents: vi.fn(), onMissedWindow: vi.fn() }),
      { initialProps: { sessionId: null as string | null } },
    );
    expect(socketOptions.namespace).toBe("course-copilot");
    expect(socketOptions.label).toBe("course-copilot");
    expect(socketOptions.enabled).toBe(false);

    rerender({ sessionId: "sess-1" });
    expect(socketOptions.enabled).toBe(true);
  });

  it("can be switched off, for a session with nothing left to stream", () => {
    renderHook(() =>
      useCourseCopilotSocket({ sessionId: "sess-1", onEvents: vi.fn(), enabled: false }),
    );
    expect(socketOptions.enabled).toBe(false);
  });

  it("joins the session room, rejoins on connect, and leaves on unmount", () => {
    const { unmount } = renderHook(() =>
      useCourseCopilotSocket({ sessionId: "sess-1", onEvents: vi.fn() }),
    );
    expect(emit).toHaveBeenCalledWith("joinSession", { sessionId: "sess-1" });

    emit.mockClear();
    // `onConnected` reaches `emit` through a ref, which is populated after the first effect pass.
    act(() => socketOptions.onConnected());
    expect(emit).toHaveBeenCalledWith("joinSession", { sessionId: "sess-1" });

    unmount();
    expect(emit).toHaveBeenCalledWith("leaveSession", { sessionId: "sess-1" });
  });

  it("hands the socket a handlers object that survives re-renders", () => {
    const { rerender } = renderHook(() =>
      useCourseCopilotSocket({ sessionId: "sess-1", onEvents: vi.fn() }),
    );
    const first = socketOptions.handlers;
    rerender();
    expect(socketOptions.handlers).toBe(first);
  });

  it("reports `connected` once the server confirms the join", () => {
    const { result } = renderHook(() =>
      useCourseCopilotSocket({ sessionId: "sess-1", onEvents: vi.fn() }),
    );
    expect(result.current.connected).toBe(false);

    act(() => socketOptions.handlers.joined({ sessionId: "sess-1" }));
    expect(result.current.connected).toBe(true);
  });

  it("delivers each event once, by seq — a replay or a poll that already saw it is dropped", () => {
    const onEvents = vi.fn();
    renderHook(() => useCourseCopilotSocket({ sessionId: "sess-1", onEvents }));

    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: [event(1), event(2)] });
    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: [event(2), event(3)] });
    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: [event(1)] });

    expect(onEvents).toHaveBeenCalledTimes(2);
    expect(onEvents).toHaveBeenNthCalledWith(1, [event(1), event(2)]);
    expect(onEvents).toHaveBeenNthCalledWith(2, [event(3)]);
  });

  it("respects events the page fetched itself via markSeen", () => {
    const onEvents = vi.fn();
    const { result } = renderHook(() => useCourseCopilotSocket({ sessionId: "sess-1", onEvents }));

    act(() => result.current.markSeen([event(5)]));
    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: [event(5)] });

    expect(onEvents).not.toHaveBeenCalled();
  });

  it("ignores a batch for another session", () => {
    const onEvents = vi.fn();
    renderHook(() => useCourseCopilotSocket({ sessionId: "sess-1", onEvents }));

    socketOptions.handlers.copilotEvents({ sessionId: "sess-OTHER", events: [event(1)] });

    expect(onEvents).not.toHaveBeenCalled();
  });

  it("ignores malformed payloads", () => {
    const onEvents = vi.fn();
    renderHook(() => useCourseCopilotSocket({ sessionId: "sess-1", onEvents }));

    socketOptions.handlers.copilotEvents(null);
    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: "nope" });
    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: [{ type: "job_done" }] });

    expect(onEvents).not.toHaveBeenCalled();
  });

  it("starts de-duplication fresh for a different session", () => {
    const onEvents = vi.fn();
    const { rerender } = renderHook(
      ({ sessionId }) => useCourseCopilotSocket({ sessionId, onEvents }),
      { initialProps: { sessionId: "sess-1" } },
    );
    socketOptions.handlers.copilotEvents({ sessionId: "sess-1", events: [event(1)] });

    rerender({ sessionId: "sess-2" });
    socketOptions.handlers.copilotEvents({ sessionId: "sess-2", events: [event(1)] });

    expect(onEvents).toHaveBeenCalledTimes(2);
  });

  it("rejoins and asks the caller to refetch after a reconnect", () => {
    const onMissedWindow = vi.fn();
    renderHook(() =>
      useCourseCopilotSocket({ sessionId: "sess-1", onEvents: vi.fn(), onMissedWindow }),
    );
    emit.mockClear();

    act(() => socketOptions.onReconnected(12));

    expect(emit).toHaveBeenCalledWith("joinSession", { sessionId: "sess-1" });
    expect(onMissedWindow).toHaveBeenCalledTimes(1);
  });
});
