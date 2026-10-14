import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCopilotSse, useRoadmapCopilotStream } from "@hooks/useRoadmapCopilotStream";

/** A response whose body streams `chunks` as the server writes them. */
const sseResponse = (chunks: string[]) =>
  ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  }) as unknown as Response;

const TURN = {
  reply: "Who is this for?",
  gates: [],
  draft: null,
  readinessToken: null,
  brief: null,
};

describe("parseCopilotSse", () => {
  it("parses complete frames and keeps a partial one for the next read", () => {
    const { events, rest } = parseCopilotSse(
      'event: activity\ndata: {"id":"a","label":"Searching"}\n\nevent: ping\ndata: {}\n\nevent: turn\ndata: {"rep',
    );

    expect(events).toEqual([
      { type: "activity", data: { id: "a", label: "Searching" } },
      { type: "ping", data: {} },
    ]);
    expect(rest).toBe('event: turn\ndata: {"rep');
  });

  it("drops a malformed frame rather than throwing", () => {
    expect(parseCopilotSse("event: turn\ndata: {not json\n\n").events).toEqual([]);
  });
});

describe("useRoadmapCopilotStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with the turn and the lookups it made, even across split chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'event: activity\ndata: {"id":"a","label":"Searching the roadmap"}\n\n',
            'event: activity_done\ndata: {"id":"a","summary":"2 related","ok":true}\n\nevent: tu',
            `rn\ndata: ${JSON.stringify(TURN)}\n\n`,
          ]),
        ),
    );
    const { result } = renderHook(() => useRoadmapCopilotStream());

    let outcome: Awaited<ReturnType<typeof result.current.runTurn>> | undefined;
    await act(async () => {
      outcome = await result.current.runTurn({ messages: [], brief: null });
    });

    expect(outcome?.turn.reply).toBe("Who is this for?");
    expect(outcome?.activity).toEqual([
      { id: "a", label: "Searching the roadmap", summary: "2 related", ok: true },
    ]);
    expect(result.current.isThinking).toBe(false);
  });

  it("rejects with the server's message on an error frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(['event: error\ndata: {"message":"I couldn\'t finish thinking."}\n\n']),
        ),
    );
    const { result } = renderHook(() => useRoadmapCopilotStream());

    await act(async () => {
      await expect(result.current.runTurn({ messages: [], brief: null })).rejects.toThrow(
        "I couldn't finish thinking.",
      );
    });
  });

  it("treats a stream that closes without a turn as a failure, not an answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(["event: ping\ndata: {}\n\n"])));
    const { result } = renderHook(() => useRoadmapCopilotStream());

    await act(async () => {
      await expect(result.current.runTurn({ messages: [], brief: null })).rejects.toThrow(
        /did not go through/,
      );
    });
  });

  it("omits a null brief from the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([`event: turn\ndata: ${JSON.stringify(TURN)}\n\n`]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useRoadmapCopilotStream());

    await act(async () => {
      await result.current.runTurn({ messages: [{ role: "admin", content: "Hi" }], brief: null });
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      messages: [{ role: "admin", content: "Hi" }],
    });
  });
});
