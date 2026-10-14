import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import {
  COURSE_COPILOT_KICKOFF_MESSAGE,
  mapServerMessagesToFeed,
  parseSseBuffer,
  useCourseCopilotStream,
} from "@hooks/useCourseCopilotStream";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

/** A response whose body streams `frames` as SSE, the way the server does. */
const sseResponse = (frames: string[]) =>
  ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
  }) as unknown as Response;

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const DONE = frame("done", { messageSeq: 2, sessionStatus: "INTERVIEWING" });

const mockFetchOnce = (...responses: Response[]) => {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(fetchMock.mock.calls[call][1].body as string);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("parseSseBuffer", () => {
  it("parses whole frames and keeps a partial one as the remainder", () => {
    const { events, rest, droppedCount } = parseSseBuffer(
      `${frame("token", { delta: "Hi" })}event: token\ndata: {"del`,
    );
    expect(events).toEqual([{ type: "token", data: { delta: "Hi" } }]);
    expect(rest).toContain('{"del');
    expect(droppedCount).toBe(0);
  });

  it("counts a malformed frame instead of silently losing it", () => {
    const { events, droppedCount } = parseSseBuffer(
      `event: blueprint\ndata: {not json}\n\n${frame("ping", { at: 1 })}`,
    );
    expect(events).toHaveLength(1);
    expect(droppedCount).toBe(1);
  });
});

describe("mapServerMessagesToFeed", () => {
  it("keeps a failed turn on screen after a reload", () => {
    // A turn that died left a row with no prose, which rendered as nothing — so the trainer's own
    // message sat there answered by silence, indistinguishable from the copilot still thinking.
    const feed = mapServerMessagesToFeed([
      { id: "u1", seq: 1, role: "user", content: "Build it." },
      {
        id: "a1",
        seq: 2,
        role: "assistant",
        content: null,
        metadata: { errored: true, errorMessage: "The model was unavailable. Try again." },
      },
    ] as never);

    expect(feed).toHaveLength(2);
    expect(feed[1].error).toBe("The model was unavailable. Try again.");
  });

  it("falls back to generic copy when the server sent no reason", () => {
    const feed = mapServerMessagesToFeed([
      { id: "a1", seq: 1, role: "assistant", content: null, metadata: { errored: true } },
    ] as never);
    expect(feed[0].error).toBe(en.courseCopilot.chat.streamFailed);
  });

  it("still drops a genuinely empty row that did not fail", () => {
    const feed = mapServerMessagesToFeed([
      { id: "a1", seq: 1, role: "assistant", content: "" },
    ] as never);
    expect(feed).toHaveLength(0);
  });

  it("does not show the hidden kickoff turn as something the trainer typed", () => {
    const feed = mapServerMessagesToFeed([
      { id: "u1", seq: 1, role: "user", content: COURSE_COPILOT_KICKOFF_MESSAGE },
      { id: "a1", seq: 2, role: "assistant", content: "What should learners be able to do?" },
    ] as never);
    expect(feed.map(m => m.role)).toEqual(["assistant"]);
  });

  it("draws an answer once, on the card it answers — not again as a bubble", () => {
    const question = {
      id: "q1",
      prompt: "Who is this for?",
      kind: "singleSelect",
      options: [{ id: "o1", label: "New volunteers" }],
    };
    const feed = mapServerMessagesToFeed([
      { id: "a1", seq: 1, role: "assistant", content: "", metadata: { questions: [question] } },
      {
        id: "u1",
        seq: 2,
        role: "user",
        content: "[answers question q1] New volunteers",
        metadata: { questionId: "q1", answer: { selectedOptionIds: ["o1"] } },
      },
    ] as never);

    expect(feed).toHaveLength(1);
    expect(feed[0].question?.id).toBe("q1");
    expect(feed[0].answeredWith).toBe("New volunteers");
    expect(feed[0].answeredAnswer).toEqual({ selectedOptionIds: ["o1"] });
  });

  it("keeps an answer's text when its card is not in the feed", () => {
    const feed = mapServerMessagesToFeed([
      { id: "u1", seq: 1, role: "user", content: "Volunteers", metadata: { questionId: "gone" } },
    ] as never);
    expect(feed).toHaveLength(1);
    expect(feed[0].content).toBe("Volunteers");
  });

  it("rebuilds review findings and suggested actions from metadata", () => {
    const feed = mapServerMessagesToFeed([
      {
        id: "a1",
        seq: 5,
        role: "assistant",
        content: "The build is done.",
        metadata: {
          reviewNotes: { findings: [{ severity: "fix", note: "Quiz 2.3 has one answer key." }] },
          suggestedActions: [{ label: "Open in editor", message: "Open the editor" }],
        },
      },
    ] as never);
    expect(feed[0].reviewFindings).toHaveLength(1);
    expect(feed[0].suggestedActions).toEqual([
      { label: "Open in editor", message: "Open the editor" },
    ]);
  });

  it("shows a persisted tool note only for the tools the contract lists", () => {
    const feed = mapServerMessagesToFeed([
      {
        id: "a1",
        seq: 1,
        role: "assistant",
        content: "Looked around.",
        toolResults: [
          { toolUseId: "t1", name: "search_library", result: { summary: "Found 4 roleplays" } },
          { toolUseId: "t2", name: "update_brief", result: { summary: "Updated the brief" } },
          { toolUseId: "t3", name: "get_item", result: { summary: "Read item" } },
        ],
      },
    ] as never);
    expect(feed[0].toolNotes).toEqual(["Found 4 roleplays"]);
  });

  // Builder lesson: agent-authored arrays can be anything.
  it("survives agent-authored fields that are not arrays", () => {
    const feed = mapServerMessagesToFeed([
      {
        id: "a1",
        seq: 1,
        role: "assistant",
        content: "Hi",
        toolResults: "nope",
        metadata: {
          questions: "nope",
          suggestedActions: { label: "x" },
          reviewNotes: { findings: "nope" },
        },
      },
    ] as never);
    expect(feed).toHaveLength(1);
    expect(feed[0].content).toBe("Hi");
    expect(feed[0].suggestedActions).toBeUndefined();
    expect(feed[0].reviewFindings).toBeUndefined();
  });
});

describe("useCourseCopilotStream — a refused turn", () => {
  /**
   * The session's turn mutex was still held, so the server never read this message. It must look
   * as if it had never been sent: bubbles out, a toast saying why, and `false` so a question card
   * unlocks and the answer can be given again.
   */
  it("rolls the bubbles back, toasts, and reports that nothing was sent", async () => {
    mockFetchOnce(
      sseResponse([
        frame("error", {
          code: "turn_in_progress",
          message: "Another turn is already streaming for this session",
        }),
      ]),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    let delivered: boolean | undefined;
    await act(async () => {
      delivered = await result.current.sendMessage("Make it shorter");
    });

    expect(delivered).toBe(false);
    await waitFor(() => expect(result.current.messages).toHaveLength(0));
    expect(toast.error).toHaveBeenCalledWith(en.courseCopilot.chat.turnInProgress);
    expect(en.courseCopilot.chat.turnInProgress).toBe(
      "A reply is still being written for this session. Wait for it to finish.",
    );
  });

  // An answer marks its card rather than adding a bubble. A refused answer has to take that mark
  // back off — including when the refusal arrives before React has rendered the update that made
  // it, which is how this runs under act(): a card id captured inside that update was still empty
  // at rollback, and the card stayed marked on an answer the copilot never received.
  it("unmarks the card a refused answer was for", async () => {
    mockFetchOnce(
      sseResponse([
        frame("error", {
          code: "turn_in_progress",
          message: "Another turn is already streaming for this session",
        }),
      ]),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));
    act(() => {
      result.current.hydrateMessages([
        {
          id: "a1",
          seq: 1,
          role: "assistant",
          content: "",
          metadata: {
            questions: [{ id: "q1", prompt: "Who is this course for?", kind: "singleSelect" }],
          },
          createdAt: "2026-10-14T00:00:00.000Z",
        },
      ] as never);
    });

    let delivered: boolean | undefined;
    await act(async () => {
      delivered = await result.current.sendMessage("New volunteers", {
        questionId: "q1",
        answer: { selectedOptionIds: ["o2"] },
      });
    });

    expect(delivered).toBe(false);
    const card = result.current.messages.find(message => message.question);
    expect(card?.answeredWith).toBeUndefined();
    expect(card?.answeredAnswer).toBeUndefined();
    expect(result.current.messages).toHaveLength(1);
  });

  it("keeps a turn the server did run", async () => {
    mockFetchOnce(sseResponse([frame("token", { delta: "Working on it" }), DONE]));
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    let delivered: boolean | undefined;
    await act(async () => {
      delivered = await result.current.sendMessage("Her name is Asha");
    });

    expect(delivered).toBe(true);
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[1].content).toBe("Working on it");
    expect(result.current.messages[1].isStreaming).toBe(false);
  });
});

describe("useCourseCopilotStream — frames", () => {
  it("hands brief, blueprint, course_patch, build_started and done to their callbacks", async () => {
    const brief = { audience: { who: "New volunteers" } };
    const readiness = { ready: false, missing: ["Assessment"] };
    const blueprintResponse = { blueprint: { title: "T" }, version: 3, problems: [] };
    const outline = { trackId: "t1", sections: [] };
    const callbacks = {
      onBrief: vi.fn(),
      onBlueprint: vi.fn(),
      onCoursePatch: vi.fn(),
      onBuildStarted: vi.fn(),
      onDone: vi.fn(),
      onTurnEnd: vi.fn(),
    };
    mockFetchOnce(
      sseResponse([
        frame("brief", { brief, readiness }),
        frame("blueprint", blueprintResponse),
        frame("course_patch", { summary: "Renamed section 2", outline }),
        frame("build_started", { jobCount: 2, estimateUsd: 1.5 }),
        frame("ping", { at: 1 }),
        frame("done", { messageSeq: 4, sessionStatus: "AWAITING_BLUEPRINT", blueprintVersion: 3 }),
      ]),
    );
    const { result } = renderHook(() =>
      useCourseCopilotStream({ sessionId: "sess-1", ...callbacks }),
    );

    await act(async () => {
      await result.current.sendMessage("Go");
    });

    expect(callbacks.onBrief).toHaveBeenCalledWith(brief, readiness);
    expect(callbacks.onBlueprint).toHaveBeenCalledWith(blueprintResponse);
    expect(callbacks.onCoursePatch).toHaveBeenCalledWith({
      summary: "Renamed section 2",
      outline,
    });
    expect(callbacks.onBuildStarted).toHaveBeenCalledWith({ jobCount: 2, estimateUsd: 1.5 });
    expect(callbacks.onDone).toHaveBeenCalledWith({
      messageSeq: 4,
      sessionStatus: "AWAITING_BLUEPRINT",
      blueprintVersion: 3,
    });
    expect(callbacks.onTurnEnd).toHaveBeenCalledTimes(1);
  });

  it("adds a tool note from the result summary, only for the tools the contract lists", async () => {
    mockFetchOnce(
      sseResponse([
        frame("tool_call", { name: "update_brief", input: {} }),
        frame("tool_result", { name: "update_brief", summary: "Updated the brief" }),
        frame("tool_call", { name: "search_library", input: {} }),
        frame("tool_result", { name: "search_library", summary: "Found 4 matching roleplays" }),
        frame("tool_result", { name: "ask_trainer", summary: "Asked" }),
        frame("tool_result", { name: "add_item", summary: "Added a quiz to section 2" }),
        frame("tool_result", { name: "get_item", summary: "Read item" }),
        frame("token", { delta: "Done." }),
        DONE,
      ]),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Add a quiz");
    });

    const assistant = result.current.messages.find(m => m.role === "assistant");
    expect(assistant?.toolNotes).toEqual([
      "Found 4 matching roleplays",
      "Added a quiz to section 2",
    ]);
    expect(assistant?.content).toBe("Done.");
  });

  it("renders a question as its own card row", async () => {
    const question = {
      id: "q1",
      prompt: "Who is this for?",
      kind: "singleSelect",
      options: [{ id: "o1", label: "New volunteers", recommended: true }],
    };
    mockFetchOnce(sseResponse([frame("question", question), DONE]));
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Let's go");
    });

    const card = result.current.messages.find(m => m.question);
    expect(card?.question?.id).toBe("q1");
    expect(card?.content).toBe("Who is this for?");
  });

  it("answers on the card and adds no second bubble", async () => {
    const question = { id: "q1", prompt: "Who?", kind: "singleSelect", options: [] };
    mockFetchOnce(
      sseResponse([frame("question", question), DONE]),
      sseResponse([frame("token", { delta: "Great." }), DONE]),
    );
    const fetchMock = vi.mocked(globalThis.fetch);
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Hi");
    });
    await act(async () => {
      await result.current.sendMessage("New volunteers", {
        questionId: "q1",
        answer: { selectedOptionIds: ["o1"] },
      });
    });

    expect(bodyOf(fetchMock as never, 1)).toEqual({
      message: "New volunteers",
      questionId: "q1",
      answer: { selectedOptionIds: ["o1"] },
    });
    const card = result.current.messages.find(m => m.question);
    expect(card?.answeredWith).toBe("New volunteers");
    // user "Hi", assistant, card, assistant reply — no second user bubble for the answer.
    expect(result.current.messages.filter(m => m.role === "user")).toHaveLength(1);
  });

  it("sends the hidden kickoff turn without a trainer bubble", async () => {
    mockFetchOnce(sseResponse([frame("token", { delta: "Welcome." }), DONE]));
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage(COURSE_COPILOT_KICKOFF_MESSAGE, undefined, true);
    });

    expect(result.current.messages.map(m => m.role)).toEqual(["assistant"]);
  });
});

describe("useCourseCopilotStream — failure handling", () => {
  /**
   * Stacks: "Preserve State During Agent Failure in Multistep Tasks" — the failed bubble keeps
   * its place and says why; the feed is not wiped.
   */
  it.each([
    "provider_rate_limited",
    "provider_unavailable",
    "provider_quota_exhausted",
    "invalid_tool_call",
    "empty_turn",
    "response_truncated",
    "stream_failed",
  ])("puts the server message on the bubble with a Retry flag for %s", async code => {
    mockFetchOnce(sseResponse([frame("error", { code, message: "The model was unavailable." })]));
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(result.current.messages).toHaveLength(2);
    const bubble = result.current.messages[1];
    expect(bubble.error).toBe("The model was unavailable.");
    expect(bubble.retryable).toBe(true);
  });

  it.each(["copilot_misconfigured", "structure_locked", "budget_exceeded", "request_too_large"])(
    "shows the message but offers no Retry for %s",
    async code => {
      mockFetchOnce(sseResponse([frame("error", { code, message: "Server wording." })]));
      const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const bubble = result.current.messages[1];
      expect(bubble.error).toBe("Server wording.");
      expect(bubble.retryable).toBe(false);
      // Persistent inline error: it is the bubble, not a toast that disappears.
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("retryLast re-sends the same turn without a duplicate bubble, and drops the chip", async () => {
    const fetchMock = mockFetchOnce(
      sseResponse([frame("error", { code: "provider_unavailable", message: "Unavailable." })]),
      sseResponse([frame("token", { delta: "Here you go." }), DONE]),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Make it shorter");
    });
    await act(async () => {
      await result.current.retryLast();
    });

    expect(bodyOf(fetchMock, 1).message).toBe("Make it shorter");
    // user bubble (once), failed bubble (chip gone), new reply
    expect(result.current.messages.map(m => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(result.current.messages[1].retryable).toBe(false);
    expect(result.current.messages[1].error).toBe("Unavailable.");
    expect(result.current.messages[2].content).toBe("Here you go.");
  });

  it("flags a stream that closes with no done frame as failed and retryable", async () => {
    // A proxy timeout looks like a clean EOF; a half-written bubble would read as finished.
    mockFetchOnce(sseResponse([frame("token", { delta: "Half a sentence" })]));
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    const bubble = result.current.messages[1];
    expect(bubble.content).toBe("Half a sentence");
    expect(bubble.error).toBe(en.courseCopilot.chat.streamFailed);
    expect(bubble.retryable).toBe(true);
  });

  it("marks a stopped turn interrupted and keeps the partial text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frame("token", { delta: "Partial" })));
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("Aborted", "AbortError")),
              );
            },
          }),
        } as unknown as Response),
      ),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    let sending: Promise<boolean> | undefined;
    act(() => {
      sending = result.current.sendMessage("Write something long");
    });
    await waitFor(() => expect(result.current.messages[1]?.content).toBe("Partial"));
    act(() => result.current.stop());
    await act(async () => {
      await sending;
    });

    const bubble = result.current.messages[1];
    expect(bubble.interrupted).toBe(true);
    expect(bubble.content).toBe("Partial");
    expect(bubble.error).toBeUndefined();
    expect(result.current.isStreaming).toBe(false);
  });

  it("replays a turn once against a replacement when the session is gone", async () => {
    const fetchMock = mockFetchOnce(
      sseResponse([frame("error", { code: "session_not_found", message: "Gone" })]),
      sseResponse([frame("token", { delta: "Welcome back." }), DONE]),
    );
    const onSessionInvalid = vi.fn().mockResolvedValue("sess-2");
    const { result } = renderHook(() =>
      useCourseCopilotStream({ sessionId: "sess-1", onSessionInvalid }),
    );

    let delivered: boolean | undefined;
    await act(async () => {
      delivered = await result.current.sendMessage("Hello");
    });

    expect(delivered).toBe(true);
    expect(onSessionInvalid).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/sessions/sess-1/messages/stream");
    expect(fetchMock.mock.calls[1][0]).toContain("/sessions/sess-2/messages/stream");
    // The raw error never reached the feed; the replayed turn did.
    expect(result.current.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(result.current.messages[1].content).toBe("Welcome back.");
  });

  it("gives up cleanly when no replacement can be created", async () => {
    mockFetchOnce(sseResponse([frame("error", { code: "session_not_found", message: "Gone" })]));
    const onSessionInvalid = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useCourseCopilotStream({ sessionId: "sess-1", onSessionInvalid }),
    );

    let delivered: boolean | undefined;
    await act(async () => {
      delivered = await result.current.sendMessage("Hello");
    });

    expect(delivered).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(en.courseCopilot.chat.streamFailed);
  });

  it("retries once with a refreshed token after a 401", async () => {
    localStorage.setItem("adminRefreshToken", "refresh-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "new-access", refreshToken: "new-refresh" }),
      } as unknown as Response)
      .mockResolvedValueOnce(sseResponse([frame("token", { delta: "Ok" }), DONE]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe("Bearer new-access");
    expect(result.current.messages[1].content).toBe("Ok");
    localStorage.clear();
  });
});

describe("useCourseCopilotStream — server sync", () => {
  const userRow = (seq: number, content: string) => ({
    id: `u${seq}`,
    seq,
    role: "user",
    content,
    createdAt: "",
  });
  const assistantRow = (seq: number, content: string, metadata: object | null = null) => ({
    id: `a${seq}`,
    seq,
    role: "assistant",
    content,
    metadata,
    createdAt: "",
  });

  it("appends a message the server posted outside any turn, and nothing it already shows", async () => {
    mockFetchOnce(sseResponse([frame("token", { delta: "Hi" }), DONE]));
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));

    act(() => result.current.hydrateMessages([userRow(1, "Hello") as never]));
    await act(async () => {
      await result.current.sendMessage("Hello again"); // done → messageSeq 2
    });
    expect(result.current.messages).toHaveLength(3);

    // Same snapshot the feed already represents: no change.
    act(() =>
      result.current.syncServerMessages([userRow(1, "Hello"), assistantRow(2, "Hi")] as never),
    );
    expect(result.current.messages).toHaveLength(3);

    // The reviewer posts after the build: seq 3 is new.
    act(() =>
      result.current.syncServerMessages([
        userRow(1, "Hello"),
        assistantRow(2, "Hi"),
        assistantRow(3, "The build is done.", {
          suggestedActions: [{ label: "Open in editor", message: "Open the editor" }],
        }),
      ] as never),
    );
    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages[3].content).toBe("The build is done.");
    expect(result.current.messages[3].suggestedActions).toHaveLength(1);

    // And is not appended twice by the next poll.
    act(() =>
      result.current.syncServerMessages([
        userRow(1, "Hello"),
        assistantRow(2, "Hi"),
        assistantRow(3, "The build is done."),
      ] as never),
    );
    expect(result.current.messages).toHaveLength(4);
  });

  it("does not draw a stopped turn a second time when the snapshot catches up", async () => {
    // A stopped turn ends with no `done`, so its seq is unknown. The server DID record it (a user
    // row and a partial assistant row), and the feed already shows both.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frame("token", { delta: "Partial" })));
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("Aborted", "AbortError")),
              );
            },
          }),
        } as unknown as Response),
      ),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));
    act(() => result.current.hydrateMessages([]));

    let sending: Promise<boolean> | undefined;
    act(() => {
      sending = result.current.sendMessage("Write something long");
    });
    await waitFor(() => expect(result.current.messages[1]?.content).toBe("Partial"));
    act(() => result.current.stop());
    await act(async () => {
      await sending;
    });
    expect(result.current.messages).toHaveLength(2);

    act(() =>
      result.current.syncServerMessages([
        userRow(1, "Write something long"),
        assistantRow(2, "Partial", { interrupted: true }),
      ] as never),
    );
    expect(result.current.messages).toHaveLength(2);
  });

  it("ignores a snapshot while a turn is streaming", async () => {
    let release: () => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              release = () => {
                controller.enqueue(new TextEncoder().encode(DONE));
                controller.close();
              };
            },
          }),
        } as unknown as Response),
      ),
    );
    const { result } = renderHook(() => useCourseCopilotStream({ sessionId: "sess-1" }));
    act(() => result.current.hydrateMessages([]));

    let sending: Promise<boolean> | undefined;
    act(() => {
      sending = result.current.sendMessage("Hello");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => result.current.syncServerMessages([assistantRow(7, "From elsewhere")] as never));
    expect(result.current.messages.some(m => m.content === "From elsewhere")).toBe(false);

    await act(async () => {
      release();
      await sending;
    });
  });
});
