import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ally-ui-mono/ui-shared", async () => {
  const { classifyMicrophoneError } = await vi.importActual<
    typeof import("../../../../../../../libs/ui-shared/src/lib/simulation/microphoneError")
  >("../../../../../../../libs/ui-shared/src/lib/simulation/microphoneError");
  return { classifyMicrophoneError, logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
});

import {
  FALSE_TRIGGER_WINDOW_MS,
  ROOM_EVENTS,
  TRANSCRIPTION_TOPIC,
  useGuideVoice,
  VoiceSession,
} from "../useGuideVoice";

/** A stand-in for livekit-client's Room: emits what the tests tell it to. */
class MockRoom {
  listeners = new Map<string, Set<(...args: any[]) => void>>();
  textHandlers = new Map<string, (reader: any, participant: { identity?: string }) => void>();
  connected = false;
  micEnabled: boolean[] = [];
  micError: Error | null = null;
  connectError: Error | null = null;
  remoteParticipants = new Map<string, { identity: string; attributes?: Record<string, string> }>();
  localParticipant = {
    identity: "learner-1",
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      if (this.micError) throw this.micError;
      this.micEnabled.push(enabled);
    }),
  };
  on = (event: string, fn: (...args: any[]) => void) => {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  };
  off = (event: string, fn: (...args: any[]) => void) => {
    this.listeners.get(event)?.delete(fn);
  };
  emit = (event: string, ...args: any[]) => this.listeners.get(event)?.forEach(fn => fn(...args));
  connect = vi.fn(async () => {
    if (this.connectError) throw this.connectError;
    this.connected = true;
  });
  disconnect = vi.fn(async () => {
    this.connected = false;
  });
  registerTextStreamHandler = vi.fn((topic: string, handler: any) =>
    this.textHandlers.set(topic, handler),
  );
  unregisterTextStreamHandler = vi.fn((topic: string) => this.textHandlers.delete(topic));

  /** Streams a caption on `lk.transcription` from `identity`. */
  caption(identity: string, chunks: string[], final = true) {
    const reader = {
      info: { attributes: { "lk.transcription_final": String(final) } },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    };
    this.textHandlers.get(TRANSCRIPTION_TOPIC)?.(reader, { identity });
  }
}

const session: VoiceSession = {
  token: "tok",
  roomName: "guide-room",
  serverUrl: "wss://lk.example",
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe("useGuideVoice", () => {
  let rooms: MockRoom[];
  let requestSession: ReturnType<typeof vi.fn>;
  let onFallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    rooms = [];
    requestSession = vi.fn().mockResolvedValue(session);
    onFallback = vi.fn();
  });
  afterEach(() => vi.useRealTimers());

  const setup = (over: { prepare?: (room: MockRoom) => void; enabled?: boolean } = {}) =>
    renderHook(() =>
      useGuideVoice({
        threadId: "t1",
        enabled: over.enabled ?? true,
        language: "hi-IN",
        requestSession,
        onFallback,
        createRoom: async () => {
          const room = new MockRoom();
          over.prepare?.(room);
          rooms.push(room);
          return room;
        },
      }),
    );

  it("asks for a session, joins the room and opens the microphone (hands-free)", async () => {
    const { result } = setup();
    await act(() => result.current.start());
    expect(requestSession).toHaveBeenCalledWith({ turnMode: "hands_free", language: "hi" });
    expect(rooms[0].connect).toHaveBeenCalledWith("wss://lk.example", "tok");
    expect(rooms[0].micEnabled).toEqual([true]);
    expect(result.current.state.phase).toBe("live");
    expect(result.current.active).toBe(true);
  });

  it("does nothing when voice is off for this course", async () => {
    const { result } = setup({ enabled: false });
    await act(() => result.current.start());
    expect(requestSession).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe("off");
  });

  it("shows Ally's captions and the learner's as they stream", async () => {
    const { result } = setup();
    await act(() => result.current.start());
    act(() => rooms[0].caption("guide-agent", ["Hello ", "there."]));
    await flush();
    expect(result.current.state.allyCaption).toBe("Hello there.");
    act(() => rooms[0].caption("learner-1", ["I'm ready"]));
    await flush();
    expect(result.current.state.learnerCaption).toBe("I'm ready");
  });

  it("follows the agent's state from its participant attributes", async () => {
    const { result } = setup();
    await act(() => result.current.start());
    act(() =>
      rooms[0].emit(
        ROOM_EVENTS.ParticipantAttributesChanged,
        { "lk.agent.state": "speaking" },
        {
          identity: "guide-agent",
          attributes: { "lk.agent.state": "speaking" },
        },
      ),
    );
    expect(result.current.state.agentState).toBe("speaking");
  });

  it("microphone refused: the classified reason, the room let go, and text", async () => {
    const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    const { result } = setup({ prepare: room => (room.micError = denied) });
    await act(() => result.current.start());
    expect(result.current.state).toMatchObject({
      phase: "failed",
      failure: "microphone",
      microphoneError: { kind: "blocked", name: "NotAllowedError" },
    });
    expect(rooms[0].disconnect).toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith("microphone");
  });

  it("voice switched off on the server: falls back to text", async () => {
    requestSession.mockRejectedValue({ status: 403, data: { errorCode: "GUIDE_DISABLED" } });
    const { result } = setup();
    await act(() => result.current.start());
    expect(result.current.state).toMatchObject({ phase: "failed", failure: "disabled" });
  });

  it("a dropped room gets exactly one reconnect attempt, then text", async () => {
    const { result } = setup();
    await act(() => result.current.start());

    await act(async () => {
      rooms[0].emit(ROOM_EVENTS.Disconnected);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestSession).toHaveBeenCalledTimes(2);
    expect(rooms).toHaveLength(2);
    expect(result.current.state.phase).toBe("live");

    await act(async () => {
      rooms[1].emit(ROOM_EVENTS.Disconnected);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestSession).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({ phase: "failed", failure: "network" });
    expect(onFallback).toHaveBeenCalledWith("network");
  });

  it("leaving on purpose is not a drop", async () => {
    const { result } = setup();
    await act(() => result.current.start());
    await act(() => result.current.stop());
    act(() => rooms[0].emit(ROOM_EVENTS.Disconnected));
    expect(requestSession).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("off");
  });

  it("suggests push-to-talk after two false triggers, and push-to-talk opens the mic only while held", async () => {
    const { result } = setup();
    await act(() => result.current.start());
    const room = rooms[0];
    const burst = async () => {
      act(() => room.emit(ROOM_EVENTS.ActiveSpeakersChanged, [{ identity: "learner-1" }]));
      act(() => room.emit(ROOM_EVENTS.ActiveSpeakersChanged, []));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FALSE_TRIGGER_WINDOW_MS + 10);
      });
    };
    await burst();
    expect(result.current.state.suggestPushToTalk).toBe(false);
    await burst();
    expect(result.current.state.suggestPushToTalk).toBe(true);

    await act(() => result.current.setTurnMode("push_to_talk"));
    expect(result.current.state).toMatchObject({
      turnMode: "push_to_talk",
      suggestPushToTalk: false,
    });
    expect(room.micEnabled.at(-1)).toBe(false);
    await act(() => result.current.pressToTalk(true));
    expect(room.micEnabled.at(-1)).toBe(true);
    await act(() => result.current.pressToTalk(false));
    expect(room.micEnabled.at(-1)).toBe(false);
  });

  it("speech that becomes words is not a false trigger", async () => {
    const { result } = setup();
    await act(() => result.current.start());
    const room = rooms[0];
    for (let i = 0; i < 3; i += 1) {
      act(() => room.emit(ROOM_EVENTS.ActiveSpeakersChanged, [{ identity: "learner-1" }]));
      act(() => room.emit(ROOM_EVENTS.ActiveSpeakersChanged, []));
      act(() => room.caption("learner-1", ["Okay"]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FALSE_TRIGGER_WINDOW_MS + 10);
      });
    }
    expect(result.current.state.suggestPushToTalk).toBe(false);
  });

  it("a roleplay launch suspends voice and offers Resume, never rejoining on its own", async () => {
    const { result, unmount } = setup();
    await act(() => result.current.start());
    await act(() => result.current.suspend());
    expect(rooms[0].disconnect).toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: "off", canResume: true });
    unmount();

    // Back from the roleplay: the page offers Resume and has not joined anything.
    const again = setup();
    expect(again.result.current.state.canResume).toBe(true);
    expect(requestSession).toHaveBeenCalledTimes(1);
    await act(() => again.result.current.start());
    expect(again.result.current.state.canResume).toBe(false);
    expect(sessionStorage.getItem("allyGuideVoiceResume")).toBeNull();
  });

  it("lets go of the room on unmount", async () => {
    const { result, unmount } = setup();
    await act(() => result.current.start());
    unmount();
    await flush();
    expect(rooms[0].disconnect).toHaveBeenCalled();
  });
});
