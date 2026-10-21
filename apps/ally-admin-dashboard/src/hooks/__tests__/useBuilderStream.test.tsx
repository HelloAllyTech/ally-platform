import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { mapServerMessagesToFeed, useBuilderStream } from "@hooks/useBuilderStream";
import { BuilderServerMessage, BuilderTurnReceipt } from "@types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

const message = (overrides: Partial<BuilderServerMessage>): BuilderServerMessage => ({
  id: "m1",
  seq: 1,
  role: "assistant",
  content: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  ...overrides,
});

describe("mapServerMessagesToFeed", () => {
  it("keeps a failed turn on screen after a reload", () => {
    // The bug this guards: a turn that died left a row with no prose and no
    // tool results, which rendered as nothing at all — so the admin's own
    // message sat there answered by silence, indistinguishable from the agent
    // still thinking.
    const feed = mapServerMessagesToFeed([
      message({ id: "u1", role: "user", content: "complete the PRD" }),
      message({
        id: "a1",
        metadata: { errored: true, errorMessage: "That turn ran past the response limit." },
      }),
    ]);

    expect(feed).toHaveLength(2);
    expect(feed[1].error).toBe("That turn ran past the response limit.");
  });

  it("falls back to generic copy when the server sent no reason", () => {
    const feed = mapServerMessagesToFeed([message({ metadata: { errored: true } })]);

    expect(feed[0].error).toBe(en.builder.chat.streamFailed);
  });

  it("still drops a genuinely empty row that did not fail", () => {
    const feed = mapServerMessagesToFeed([message({ content: "" })]);

    expect(feed).toHaveLength(0);
  });

  it("draws an answer once, on the card it answers", () => {
    // It used to be drawn twice — as the card's "Answered — …" state and again
    // as a bubble directly under it — which reads exactly like a click that
    // double-fired, right next to the answer it was meant to confirm.
    const feed = mapServerMessagesToFeed([
      message({
        id: "a1",
        content: "How should the generated content be presented?",
        metadata: {
          questions: [{ id: "q1", prompt: "How should it be presented?" } as never],
        },
      }),
      message({
        id: "u1",
        role: "user",
        content: "[answers question q1] Fill the form directly",
        metadata: { questionId: "q1" },
      }),
    ]);

    expect(feed.filter(entry => entry.role === "user")).toHaveLength(0);
    const card = feed.find(entry => entry.question);
    expect(card?.answeredWith).toBe("Fill the form directly");
  });

  it("keeps an answer whose question is not in the feed", () => {
    // "We could not render the card" must never read the same as "the admin
    // said nothing" — dropping the row on that basis would lose their words.
    const feed = mapServerMessagesToFeed([
      message({
        id: "u1",
        role: "user",
        content: "[answers question q9] continue",
        metadata: { questionId: "q9" },
      }),
    ]);

    expect(feed).toEqual([{ id: "srv_u1", role: "user", content: "continue" }]);
  });

  it("shows a resumed structured answer as the admin's words, without the ids for the model", () => {
    const feed = mapServerMessagesToFeed([
      message({
        id: "a1",
        content: "",
        metadata: { questions: [{ id: "q1", prompt: "Which repos?" } as never] },
      }),
      message({
        id: "u1",
        role: "user",
        content: '[answers question q1] ally-be, my own [selected ids: be | custom: "my own"]',
        metadata: {
          questionId: "q1",
          answer: { selectedOptionIds: ["be"], customValues: ["my own"] },
        },
      }),
    ]);

    const card = feed.find(entry => entry.question);
    expect(card?.answeredWith).toBe("ally-be, my own");
  });
});

const receipt: BuilderTurnReceipt = {
  read: ["ally-be/src/builder/x.ts"],
  searched: ['Code search "debrief rating" — 4 matches'],
  changed: ["Requirements: added R4"],
  prdVersion: { from: 7, to: 8 },
  failed: ["Read ally-be/src/gone.ts — Not Found"],
  warnings: [],
};

describe("mapServerMessagesToFeed — turn receipts", () => {
  it("carries the receipt onto the assistant row", () => {
    const feed = mapServerMessagesToFeed([
      message({ content: "Added the requirement.", metadata: { receipt } }),
    ]);

    expect(feed).toHaveLength(1);
    expect(feed[0].receipt).toEqual(receipt);
  });

  it("drops the tool chips when the row has a receipt — the receipt is the record", () => {
    // Chips came from `toolResults[].name`, a second account of the turn that was never
    // de-duplicated against anything and could not say a lookup had failed.
    const feed = mapServerMessagesToFeed([
      message({
        content: "Added the requirement.",
        toolResults: [
          { toolUseId: "t1", name: "github_read_file", result: "ok" },
          { toolUseId: "t2", name: "upsert_requirement", result: "ok" },
        ],
        metadata: { receipt },
      }),
    ]);

    expect(feed[0].receipt).toEqual(receipt);
    expect(feed[0].toolNotes).toBeUndefined();
  });

  it("draws a row whose only content is its receipt", () => {
    // A turn that only looked things up has no prose and (with chips gone) no tools — it used to
    // vanish, and the receipt is the one place that says what it did.
    const feed = mapServerMessagesToFeed([message({ content: null, metadata: { receipt } })]);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ role: "assistant", content: "", receipt });
  });

  it("keeps the chips on a row from before receipts existed", () => {
    const feed = mapServerMessagesToFeed([
      message({
        content: "Here is what I found.",
        toolResults: [{ toolUseId: "t1", name: "github_search_code", result: "ok" }],
      }),
    ]);

    expect(feed[0].toolNotes).toEqual(["github_search_code"]);
    expect(feed[0]).not.toHaveProperty("receipt");
  });

  it("ignores a receipt that is not one, rather than hiding the chips behind it", () => {
    const feed = mapServerMessagesToFeed([
      message({
        content: "Hi",
        toolResults: [{ toolUseId: "t1", name: "github_read_file", result: "ok" }],
        metadata: { receipt: "nope" as never },
      }),
      message({ id: "m2", content: "", metadata: { receipt: { read: "nope" } as never } }),
    ]);

    expect(feed).toHaveLength(1);
    expect(feed[0].toolNotes).toEqual(["github_read_file"]);
    expect(feed[0]).not.toHaveProperty("receipt");
  });

  it("never puts the agent's working notes in the feed", () => {
    const feed = mapServerMessagesToFeed([
      message({
        content: "Done.",
        metadata: { receipt, workingNotes: ["private: the admin seems unsure about R2"] },
      }),
    ]);

    expect(JSON.stringify(feed)).not.toContain("private: the admin");
  });

  it("keeps the receipt on the prose row, ahead of the question card it asked", () => {
    const feed = mapServerMessagesToFeed([
      message({
        content: "One thing to settle.",
        metadata: { receipt, questions: [{ id: "q1", prompt: "Which repo?" } as never] },
      }),
    ]);

    expect(feed.map(entry => Boolean(entry.receipt))).toEqual([true, false]);
    expect(feed[1].question?.id).toBe("q1");
  });
});

/** A response whose frames are pushed by the test, so a turn can be observed part-way. */
const controlledSseResponse = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const response = {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
  } as unknown as Response;
  return {
    response,
    push: (frames: string) => controller.enqueue(encoder.encode(frames)),
    close: () => controller.close(),
  };
};

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const DONE = frame("done", { messageSeq: 2, sessionStatus: "INTERVIEWING", readinessScore: 40 });

describe("useBuilderStream — turn receipts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows tool chips while the turn runs, then swaps them for the receipt", async () => {
    // Validated turns withhold the reply until the end, so the chips are the only sign of life
    // during the wait. Once the receipt lands they are replaced by it — the same rule a reload
    // applies, so the live feed and the reloaded one look alike.
    const stream = controlledSseResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(stream.response));
    const { result } = renderHook(() => useBuilderStream({ sessionId: "sess-1" }));

    let turn!: Promise<void>;
    act(() => {
      turn = result.current.sendMessage("Add a requirement for the banner");
    });

    await act(async () => {
      stream.push(
        frame("tool_call", { name: "github_read_file", input: {} }) +
          frame("tool_call", { name: "upsert_requirement", input: {} }),
      );
    });
    await waitFor(() =>
      expect(result.current.messages[1].toolNotes).toEqual([
        "github_read_file",
        "upsert_requirement",
      ]),
    );
    expect(result.current.messages[1].receipt).toBeUndefined();

    await act(async () => {
      stream.push(frame("token", { delta: "Added R4." }) + frame("receipt", receipt) + DONE);
      stream.close();
      await turn;
    });

    const assistant = result.current.messages[1];
    expect(assistant.receipt).toEqual(receipt);
    expect(assistant.toolNotes).toBeUndefined();
    expect(assistant.content).toBe("Added R4.");
    expect(assistant.isStreaming).toBe(false);
  });

  it("puts the receipt on the reply, not on the question card that follows it", async () => {
    const stream = controlledSseResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(stream.response));
    const { result } = renderHook(() => useBuilderStream({ sessionId: "sess-1" }));

    await act(async () => {
      const turn = result.current.sendMessage("Add a requirement for the banner");
      stream.push(
        frame("token", { delta: "One thing to settle." }) +
          frame("question", { id: "q1", prompt: "Which repo?", kind: "freeText" }) +
          frame("receipt", receipt) +
          DONE,
      );
      stream.close();
      await turn;
    });

    const [, reply, card] = result.current.messages;
    expect(reply.receipt).toEqual(receipt);
    expect(card.question?.id).toBe("q1");
    expect(card.receipt).toBeUndefined();
  });

  it("keeps the chips when the receipt frame is unreadable", async () => {
    const stream = controlledSseResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(stream.response));
    const { result } = renderHook(() => useBuilderStream({ sessionId: "sess-1" }));

    await act(async () => {
      const turn = result.current.sendMessage("Add a requirement for the banner");
      stream.push(
        frame("tool_call", { name: "github_read_file", input: {} }) +
          frame("receipt", "not a receipt") +
          DONE,
      );
      stream.close();
      await turn;
    });

    const assistant = result.current.messages[1];
    expect(assistant.receipt).toBeUndefined();
    expect(assistant.toolNotes).toEqual(["github_read_file"]);
  });
});
