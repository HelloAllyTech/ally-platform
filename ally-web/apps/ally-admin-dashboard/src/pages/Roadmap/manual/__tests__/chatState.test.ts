import "@constants";
import { describe, expect, it } from "vitest";

import {
  ManualChatEvent,
  ManualChatState,
  activityText,
  applyManualChatEvent,
  initialManualChatState,
  isManualChatServerEvent,
  visibleDrafts,
} from "../utils/chatState";

const run = (events: ManualChatEvent[], from: ManualChatState = initialManualChatState) =>
  events.reduce(applyManualChatEvent, from);

const send: ManualChatEvent = {
  type: "local_send",
  data: { localId: "l1", message: "How do scores work?", context: { pageSlug: "scores" } },
};

describe("applyManualChatEvent", () => {
  it("adds the question and an empty answer that streams", () => {
    const state = run([send]);
    expect(state.streaming).toBe(true);
    expect(state.messages.map(message => [message.role, message.status])).toEqual([
      ["user", "done"],
      ["assistant", "streaming"],
    ]);
    expect(state.messages[0].context).toEqual({ pageSlug: "scores" });
  });

  it("follows a full stream in order: meta, activity, tokens, citations, draft, edit, done", () => {
    const state = run([
      send,
      { type: "meta", data: { conversationId: "c1", messageId: "m1" } },
      { type: "activity", data: { id: "a1", label: "Reading Scores" } },
      { type: "token", data: { text: "Scores " } },
      { type: "activity_done", data: { id: "a1", summary: "Read Scores", ok: true } },
      { type: "token", data: { text: "come from the judge." } },
      { type: "citation", data: { slug: "scores", title: "Scores" } },
      { type: "citation", data: { slug: "scores", title: "Scores" } },
      {
        type: "draft",
        data: { id: "d1", title: "Explain scores", text: "Show why", relatedPages: [] },
      },
      {
        type: "page_edited",
        data: { slug: "scores", title: "Scores", revisionId: "r9", reason: "Fixed range" },
      },
      { type: "done", data: { messageId: "m1" } },
    ]);
    expect(state.conversationId).toBe("c1");
    expect(state.streaming).toBe(false);
    const answer = state.messages[1];
    expect(answer.id).toBe("m1");
    expect(answer.status).toBe("done");
    expect(answer.content).toBe("Scores come from the judge.");
    expect(answer.citations).toEqual([{ slug: "scores", title: "Scores" }]);
    expect(answer.activity).toEqual([
      { id: "a1", label: "Reading Scores", summary: "Read Scores", ok: true },
    ]);
    expect(answer.edits).toEqual([
      { slug: "scores", title: "Scores", revisionId: "r9", reason: "Fixed range" },
    ]);
    expect(state.drafts).toEqual([
      {
        id: "d1",
        title: "Explain scores",
        text: "Show why",
        relatedPages: [],
        savedCode: null,
        discarded: false,
      },
    ]);
  });

  it("ignores events when nothing is streaming", () => {
    const done = run([send, { type: "done", data: {} }]);
    const after = run([{ type: "token", data: { text: "late" } }], done);
    expect(after.messages[1].content).toBe("");
  });

  it("ends on a server error with its words, closing any open activity", () => {
    const state = run([
      send,
      { type: "activity", data: { id: "a1", label: "Searching code" } },
      { type: "error", data: { message: "The manual is busy." } },
    ]);
    expect(state.streaming).toBe(false);
    expect(state.messages[1].status).toBe("error");
    expect(state.messages[1].error).toBe("The manual is busy.");
    expect(state.messages[1].activity[0].ok).toBe(false);
  });

  it("marks a stopped answer and keeps what arrived", () => {
    const state = run([
      send,
      { type: "token", data: { text: "Half" } },
      { type: "local_abort", data: { message: "Stopped." } },
    ]);
    expect(state.messages[1]).toMatchObject({ status: "stopped", content: "Half" });
  });

  it("records a local failure (a 409) the same way as an error", () => {
    const state = run([send, { type: "local_fail", data: { message: "busy" } }]);
    expect(state.messages[1]).toMatchObject({ status: "error", error: "busy" });
  });

  it("loads a saved conversation in the live shape (text, no activity) and resets", () => {
    const loaded = run([
      {
        type: "local_load",
        data: {
          id: "c2",
          title: "Old",
          createdAt: "2026-11-19T00:00:00Z",
          updatedAt: "2026-11-20T00:00:00Z",
          messages: [
            { id: "u", role: "user", text: "How do scores work?", at: "2026-11-20T00:00:00Z" },
            {
              id: "x",
              role: "assistant",
              text: "From the judge.",
              at: "2026-11-20T00:00:05Z",
              citations: [{ slug: "scores", title: "Scores" }],
              edits: [{ slug: "scores", title: "Scores", revisionId: "r9", reason: "Fixed" }],
            },
          ],
          drafts: [
            { id: "d", title: "t", text: "x", relatedPages: [], savedCode: "OPP-1" },
            { id: "e", title: "t", text: "x", relatedPages: [], discarded: true },
          ],
        },
      },
    ]);
    expect(loaded.conversationId).toBe("c2");
    expect(loaded.streaming).toBe(false);
    expect(loaded.messages[0]).toMatchObject({ role: "user", content: "How do scores work?" });
    expect(loaded.messages[1]).toMatchObject({
      content: "From the judge.",
      status: "done",
      citations: [{ slug: "scores", title: "Scores" }],
      edits: [{ slug: "scores", title: "Scores", revisionId: "r9", reason: "Fixed" }],
      // History has no activity: the "Looked at N things" receipt is not drawn.
      activity: [],
    });
    expect(visibleDrafts(loaded.drafts).map(draft => draft.id)).toEqual(["d"]);
    expect(run([{ type: "local_reset" }], loaded)).toEqual(initialManualChatState);
  });

  it("updates a draft card's saved and dismissed state", () => {
    const state = run([
      send,
      { type: "draft", data: { id: "d1", title: "t", text: "x" } },
      { type: "local_draft", data: { id: "d1", savedCode: "OPP-12" } },
    ]);
    expect(state.drafts[0]).toMatchObject({ savedCode: "OPP-12", relatedPages: [] });
  });

  it("recognises only the contract's server events", () => {
    expect(isManualChatServerEvent({ type: "token", data: {} })).toBe(true);
    expect(isManualChatServerEvent({ type: "ping", data: {} })).toBe(false);
    expect(isManualChatServerEvent({ type: "local_reset", data: {} })).toBe(false);
  });

  it("never shows a code for a failed lookup", () => {
    const failed = (summary: string | null) => ({
      id: "a",
      label: "Searching code",
      summary,
      ok: false,
    });
    expect(
      activityText(failed("Couldn't finish: github_not_configured"), "Couldn't check that"),
    ).toBe("Couldn't check that");
    expect(activityText(failed("github_not_configured"), "Couldn't check that")).toBe(
      "Couldn't check that",
    );
    expect(activityText(failed(null), "Couldn't check that")).toBe("Couldn't check that");
    expect(activityText(failed("The code search isn't set up here."), "x")).toBe(
      "The code search isn't set up here.",
    );
    expect(activityText({ id: "b", label: "Reading Scores", summary: null, ok: null }, "x")).toBe(
      "Reading Scores",
    );
  });
});
