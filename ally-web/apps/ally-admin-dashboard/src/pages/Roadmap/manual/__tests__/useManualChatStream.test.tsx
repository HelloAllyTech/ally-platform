import "@constants";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const mockFetch = vi.fn();
vi.mock("../../../../hooks/chatStream/fetchWithReauth", () => ({
  fetchWithReauth: (...args: unknown[]) => mockFetch(...args),
}));

import { useManualChatStream } from "../hooks/useManualChatStream";

const sseBody = (frames: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      frames.forEach(frame => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("useManualChatStream", () => {
  beforeEach(() => mockFetch.mockReset());

  it("streams an answer and sends the conversation id on the next turn", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        sseBody([
          frame("meta", { conversationId: "c1", messageId: "m1" }),
          frame("token", { text: "Hello" }),
          frame("done", { messageId: "m1" }),
        ]),
        { status: 200 },
      ),
    );
    const onEvent = vi.fn();
    const { result } = renderHook(() => useManualChatStream({ onEvent }));
    await act(() => result.current.send("Hi", { pageSlug: "scores", selection: "  " }));
    await waitFor(() => expect(result.current.state.streaming).toBe(false));
    expect(result.current.state.messages[1]).toMatchObject({ content: "Hello", status: "done" });
    expect(mockFetch.mock.calls[0][1]).toEqual({
      message: "Hi",
      // A blank selection is dropped rather than sent.
      context: { pageSlug: "scores" },
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "token" }));

    mockFetch.mockResolvedValueOnce(new Response(sseBody([frame("done", {})]), { status: 200 }));
    await act(() => result.current.send("Again"));
    expect(mockFetch.mock.calls[1][1]).toEqual({ conversationId: "c1", message: "Again" });
  });

  it("says another message is still being answered on a 409", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 409 }));
    const { result } = renderHook(() => useManualChatStream());
    await act(() => result.current.send("Hi"));
    expect(result.current.state.messages[1]).toMatchObject({
      status: "error",
      error: en.productManual.chat.busy,
    });
  });

  it("says the answer was cut off when the stream ends without done", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(sseBody([frame("token", { text: "Par" })]), { status: 200 }),
    );
    const { result } = renderHook(() => useManualChatStream());
    await act(() => result.current.send("Hi"));
    expect(result.current.state.messages[1]).toMatchObject({
      content: "Par",
      error: en.productManual.chat.dropped,
    });
  });

  it("refuses a message over the limit without calling the server", async () => {
    const { result } = renderHook(() => useManualChatStream());
    await act(() => result.current.send("x".repeat(4001)));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.state.messages[1].status).toBe("error");
  });

  it("marks the answer stopped when the request is aborted", async () => {
    mockFetch.mockImplementationOnce(
      (_url: string, _body: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const { result } = renderHook(() => useManualChatStream());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.send("Hi");
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    act(() => result.current.stop());
    await act(() => pending);
    expect(result.current.state.messages[1].status).toBe("stopped");
  });
});
