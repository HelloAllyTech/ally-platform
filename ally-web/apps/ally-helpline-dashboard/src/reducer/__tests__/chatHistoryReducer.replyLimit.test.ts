import { describe, expect, it } from "vitest";

import chatHistorySlice, { addMessage, setReplyLimit } from "../chatHistoryReducer";

/** Ask Ally's limit: once the reply stream says so, the thread remembers it. */
describe("chatHistory — Ask Ally's limit", () => {
  const reduce = chatHistorySlice.reducer;

  it("records the limit on the session's thread", () => {
    let state = reduce(undefined, { type: "init" });
    state = reduce(
      state,
      addMessage({ sessionId: "s-1", message: { role: "user", content: "one more" } }),
    );
    state = reduce(state, setReplyLimit({ sessionId: "s-1", limit: "session" }));
    expect(state.sessions["s-1"].replyLimit).toBe("session");
    expect(state.sessions["s-1"].messages).toHaveLength(1);
  });

  it("starts a thread when the limit arrives first", () => {
    const state = reduce(undefined, setReplyLimit({ sessionId: "s-2", limit: "month" }));
    expect(state.sessions["s-2"]).toMatchObject({ messages: [], replyLimit: "month" });
  });
});
