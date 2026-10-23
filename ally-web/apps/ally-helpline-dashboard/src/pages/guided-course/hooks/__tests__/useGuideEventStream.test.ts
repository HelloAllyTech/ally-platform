import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuideEvent } from "../../contract/wire";
import { parseSseFrames, reconnectDelay } from "@utils/sseStream";

vi.mock("@api/baseAPI", () => ({ handleLogout: vi.fn() }));

import { handleLogout } from "@api/baseAPI";

import { STREAM_DEAD_AFTER_MS, useGuideEventStream } from "../useGuideEventStream";

interface OpenStream {
  url: string;
  headers: Record<string, string>;
  push: (text: string) => void;
  close: () => void;
}

const encoder = new TextEncoder();

/** A fetch whose SSE responses the test drives by hand. */
const makeServer = () => {
  const streams: OpenStream[] = [];
  const statuses: Array<{ status: number; body?: unknown }> = [];
  const refreshCalls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/auth/refresh")) {
      refreshCalls.push(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "fresh", refreshToken: "fresh-refresh" }),
      } as unknown as Response;
    }
    const next = statuses.shift();
    if (next && next.status !== 200) {
      return {
        ok: false,
        status: next.status,
        body: null,
        json: async () => next.body ?? {},
      } as unknown as Response;
    }
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    init?.signal?.addEventListener("abort", () => {
      try {
        controller.error(new DOMException("aborted", "AbortError"));
      } catch {
        // already closed
      }
    });
    streams.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      push: text => controller.enqueue(encoder.encode(text)),
      close: () => controller.close(),
    });
    return { ok: true, status: 200, body } as unknown as Response;
  });
  return { streams, statuses, refreshCalls, fetchImpl };
};

let seq = 0;
const frame = (type: GuideEvent["type"], data: object, durable = false) => {
  if (durable) seq += 1;
  const event = { v: 1, seq, threadId: "t1", at: "", durable, type, data };
  return `event: ${type}\n${durable ? `id: ${seq}\n` : ""}data: ${JSON.stringify(event)}\n\n`;
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe("useGuideEventStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seq = 0;
    localStorage.setItem("accessToken", "token-1");
    localStorage.setItem("refreshToken", "refresh-1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const setup = (lastSeq = { value: 0 }) => {
    const server = makeServer();
    const events: GuideEvent[] = [];
    const statuses: string[] = [];
    const onFatal = vi.fn();
    const hook = renderHook(() =>
      useGuideEventStream({
        threadId: "t1",
        enabled: true,
        getLastSeq: () => lastSeq.value,
        onEvent: event => {
          events.push(event);
          if (event.durable) lastSeq.value = event.seq;
        },
        onStatus: status => statuses.push(status),
        onFatal,
        fetchImpl: server.fetchImpl,
        random: () => 0,
      }),
    );
    return { server, events, statuses, onFatal, hook, lastSeq };
  };

  it("sends the JWT in a header, delivers events and reports open on hello", async () => {
    const { server, events, statuses } = setup();
    await flush();
    expect(server.streams).toHaveLength(1);
    expect(server.streams[0].url).toMatch(/\/api\/v1\/guide\/threads\/t1\/events$/);
    expect(server.streams[0].headers.Authorization).toBe("Bearer token-1");
    expect(server.streams[0].headers["Last-Event-ID"]).toBeUndefined();

    server.streams[0].push(frame("hello", { lastSeq: 0, mode: "NORMAL", atmosphere: "bright" }));
    server.streams[0].push(
      frame(
        "assistant.message",
        { messageId: "m1", turnId: "u1", text: "Hi", channel: "text" },
        true,
      ),
    );
    await flush();

    expect(statuses).toEqual(["connecting", "open"]);
    expect(events.map(e => e.type)).toEqual(["hello", "assistant.message"]);
  });

  it("drops unknown event types instead of failing", async () => {
    const { server, events } = setup();
    await flush();
    server.streams[0].push(
      `event: future.thing\ndata: ${JSON.stringify({ type: "future.thing" })}\n\n`,
    );
    server.streams[0].push("event: hello\ndata: {not json\n\n");
    await flush();
    expect(events).toEqual([]);
  });

  it("treats 45 s of silence as a drop and resumes with Last-Event-ID", async () => {
    const { server, statuses } = setup();
    await flush();
    server.streams[0].push(frame("hello", { lastSeq: 0, mode: "NORMAL", atmosphere: "bright" }));
    server.streams[0].push(
      frame("learner.message", { messageId: "m1", text: "x", channel: "text" }, true),
    );
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_DEAD_AFTER_MS);
    });
    expect(statuses.at(-1)).toBe("lost");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(server.streams).toHaveLength(2);
    expect(server.streams[1].headers["Last-Event-ID"]).toBe("1");
  });

  it("stays connected while pings keep arriving", async () => {
    const { server } = setup();
    await flush();
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      server.streams[0].push(frame("ping", {}));
      await flush();
    }
    expect(server.streams).toHaveLength(1);
  });

  it("reconnects when the server closes the stream", async () => {
    const { server } = setup();
    await flush();
    server.streams[0].close();
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(server.streams).toHaveLength(2);
  });

  it("backs off with jitter between 1 and 15 seconds", () => {
    expect(reconnectDelay(1, () => 0)).toBe(1_000);
    expect(reconnectDelay(1, () => 1)).toBe(1_000);
    expect(reconnectDelay(3, () => 1)).toBe(4_000);
    expect(reconnectDelay(10, () => 1)).toBe(15_000);
    expect(reconnectDelay(10, () => 0.5)).toBe(8_000);
  });

  it("stops for good when the guide is switched off", async () => {
    const server = makeServer();
    server.statuses.push({ status: 403, body: { errorCode: "GUIDE_DISABLED" } });
    const onFatal = vi.fn();
    renderHook(() =>
      useGuideEventStream({
        threadId: "t1",
        enabled: true,
        getLastSeq: () => 0,
        onEvent: vi.fn(),
        onStatus: vi.fn(),
        onFatal,
        fetchImpl: server.fetchImpl,
        random: () => 0,
      }),
    );
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onFatal).toHaveBeenCalledWith("disabled");
    expect(server.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired token once and retries with the new one", async () => {
    const server = makeServer();
    server.statuses.push({ status: 401 });
    renderHook(() =>
      useGuideEventStream({
        threadId: "t1",
        enabled: true,
        getLastSeq: () => 0,
        onEvent: vi.fn(),
        onStatus: vi.fn(),
        onFatal: vi.fn(),
        fetchImpl: server.fetchImpl,
      }),
    );
    await flush();
    expect(server.refreshCalls).toEqual([JSON.stringify({ refreshToken: "refresh-1" })]);
    expect(server.streams[0].headers.Authorization).toBe("Bearer fresh");
    expect(localStorage.getItem("refreshToken")).toBe("fresh-refresh");
    expect(handleLogout).not.toHaveBeenCalled();
  });

  it("waits while offline and reconnects at once when the network returns", async () => {
    const { server, statuses } = setup();
    await flush();
    let online = false;
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(statuses.at(-1)).toBe("lost");
    expect(server.streams).toHaveLength(1);

    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    expect(server.streams).toHaveLength(2);
  });

  it("closes the stream on unmount", async () => {
    const { server, hook } = setup();
    await flush();
    hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(server.streams).toHaveLength(1);
  });
});

describe("parseSseFrames", () => {
  it("keeps a partial frame for the next chunk and reads id and event", () => {
    const { frames, rest } = parseSseFrames(
      'event: a\nid: 3\ndata: {"x":1}\n\n: comment\n\nevent: b\nda',
    );
    expect(frames).toEqual([{ event: "a", id: "3", data: '{"x":1}' }]);
    expect(rest).toBe("event: b\nda");
  });
});
