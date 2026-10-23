import { describe, expect, it } from "vitest";

import type { GuideEvent } from "../../contract/wire";
import { TrackAccessDenialReason } from "@types";

import {
  canSendNow,
  type GuidedSessionEvent,
  guidedSessionMachine,
  initialSessionState,
  shouldQueue,
  showOfflineNotice,
  turnCues,
} from "../guidedSessionMachine";

const run = (events: GuidedSessionEvent[], state = initialSessionState) =>
  events.reduce(guidedSessionMachine, state);

const server = (
  event: Partial<GuideEvent> & { type: GuideEvent["type"] },
  at = 0,
): GuidedSessionEvent => ({
  type: "SERVER_EVENT",
  at,
  event: { v: 1, seq: 0, threadId: "t1", at: "", durable: false, data: {}, ...event } as GuideEvent,
});

describe("guidedSessionMachine", () => {
  it("boots to ready and lets the learner send", () => {
    const state = run([{ type: "BOOT_OK" }]);
    expect(state.boot).toBe("ready");
    expect(canSendNow(state)).toBe(true);
  });

  it.each([
    [{ type: "BOOT_DISABLED" } as const, "disabled"],
    [{ type: "BOOT_UNAVAILABLE" } as const, "unavailable"],
    [{ type: "BOOT_SIGNED_OUT" } as const, "signed_out"],
    [{ type: "BOOT_ERROR" } as const, "error"],
  ])("ends boot in a designed state: %o", (event, boot) => {
    const state = run([event]);
    expect(state.boot).toBe(boot);
    expect(canSendNow(state)).toBe(false);
  });

  it("keeps the access-denial reason", () => {
    const state = run([{ type: "BOOT_DENIED", reason: TrackAccessDenialReason.NOT_IN_GROUP }]);
    expect(state).toMatchObject({ boot: "denied", denialReason: "NOT_IN_GROUP" });
  });

  it("walks a turn: sending → waiting → streaming → idle", () => {
    let state = run([{ type: "BOOT_OK" }, { type: "TURN_SUBMITTED", at: 1000 }]);
    expect(state.turn).toBe("sending");
    expect(canSendNow(state)).toBe(false);
    state = run(
      [
        server(
          { type: "turn.started", data: { turnId: "u1", trigger: "learner_message" } } as never,
          1100,
        ),
      ],
      state,
    );
    expect(state.turn).toBe("waiting");
    state = run([server({ type: "assistant.delta" } as never)], state);
    expect(state.turn).toBe("streaming");
    state = run([server({ type: "turn.completed" } as never)], state);
    expect(state).toMatchObject({ turn: "idle", turnSince: null });
  });

  it("shows the thinking caption after 600 ms and the slow line after 8 s", () => {
    const state = run([{ type: "BOOT_OK" }, { type: "TURN_SUBMITTED", at: 10_000 }]);
    expect(turnCues(state, 10_500)).toEqual({ thinking: true, showCaption: false, slow: false });
    expect(turnCues(state, 10_600)).toEqual({ thinking: true, showCaption: true, slow: false });
    expect(turnCues(state, 18_000)).toEqual({ thinking: true, showCaption: true, slow: true });
    const streaming = run([server({ type: "assistant.delta" } as never)], state);
    expect(turnCues(streaming, 30_000).slow).toBe(false);
  });

  it("returns to idle on a refused turn", () => {
    const state = run([
      { type: "BOOT_OK" },
      { type: "TURN_SUBMITTED", at: 0 },
      { type: "TURN_REJECTED" },
    ]);
    expect(state.turn).toBe("idle");
  });

  it("treats guide_disabled and no_access on the stream as the end of the session", () => {
    const disabled = run([
      { type: "BOOT_OK" },
      server({ type: "turn.failed", data: { code: "guide_disabled", message: "" } } as never),
    ]);
    expect(disabled.boot).toBe("disabled");
    const denied = run([
      { type: "BOOT_OK" },
      server({ type: "turn.failed", data: { code: "no_access", message: "" } } as never),
    ]);
    expect(denied.boot).toBe("denied");
    const transient = run([
      { type: "BOOT_OK" },
      server({ type: "turn.failed", data: { code: "rate_limited", message: "" } } as never),
    ]);
    expect(transient.boot).toBe("ready");
  });

  it("reconnects with a growing attempt count and resets it when the stream opens", () => {
    let state = run([{ type: "BOOT_OK" }, { type: "STREAM_CONNECTING" }, { type: "STREAM_OPEN" }]);
    expect(state.connection).toBe("open");
    state = run(
      [{ type: "STREAM_LOST" }, { type: "STREAM_CONNECTING" }, { type: "STREAM_LOST" }],
      state,
    );
    expect(state).toMatchObject({ connection: "reconnecting", reconnectAttempt: 2 });
    expect(showOfflineNotice(state)).toBe(true);
    state = run([server({ type: "hello" } as never)], state);
    expect(state).toMatchObject({ connection: "open", reconnectAttempt: 0 });
    expect(showOfflineNotice(state)).toBe(false);
  });

  it("a single quick drop does not show the offline line", () => {
    const state = run([{ type: "BOOT_OK" }, { type: "STREAM_OPEN" }, { type: "STREAM_LOST" }]);
    expect(showOfflineNotice(state)).toBe(false);
  });

  it("goes offline with the browser, queues messages, and reconnects when it comes back", () => {
    let state = run([{ type: "BOOT_OK" }, { type: "STREAM_OPEN" }, { type: "NETWORK_OFFLINE" }]);
    expect(state.connection).toBe("offline");
    expect(shouldQueue(state)).toBe(true);
    expect(showOfflineNotice(state)).toBe(true);
    state = run([{ type: "STREAM_CONNECTING" }], state);
    expect(state.connection).toBe("offline");
    state = run([{ type: "NETWORK_ONLINE" }], state);
    expect(state.connection).toBe("reconnecting");
    expect(shouldQueue(state)).toBe(false);
  });

  it("a stream drop mid-reply waits for the replay instead of claiming the turn ended", () => {
    const state = run([
      { type: "BOOT_OK" },
      { type: "TURN_SUBMITTED", at: 0 },
      server({ type: "assistant.delta" } as never),
      { type: "STREAM_LOST" },
    ]);
    expect(state.turn).toBe("waiting");
  });
});
