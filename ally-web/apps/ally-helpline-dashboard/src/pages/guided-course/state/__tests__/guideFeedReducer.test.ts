import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { GuideCard, GuideEvent } from "../../contract/wire";

import type { JourneyBootstrap } from "../../contract/bootstrap";
import {
  failureRetryText,
  type GuideFeedState,
  guideFeedReducer,
  initialFeedState,
  lastAllyMessage,
  queuedEchoes,
} from "../guideFeedReducer";

const fixtures = resolve(__dirname, "../../../../../../../../ally-be/src/guide/contract/fixtures");
const fixtureEvents = (): GuideEvent[] =>
  JSON.parse(readFileSync(resolve(fixtures, "events.json"), "utf8")).valid as GuideEvent[];

let clock = 0;
const base = (seq: number, durable: boolean) => ({
  v: 1 as const,
  seq,
  threadId: "t1",
  at: new Date(Date.UTC(2026, 9, 23, 10, 0, clock++)).toISOString(),
  durable,
});

const ev = {
  learner: (seq: number, messageId: string, text: string, clientTurnId: string | null = null) =>
    ({
      ...base(seq, true),
      type: "learner.message",
      data: { messageId, text, channel: "text", clientTurnId, turnId: "u1" },
    }) as GuideEvent,
  delta: (seq: number, messageId: string, text: string, turnId = "u1") =>
    ({
      ...base(seq, false),
      type: "assistant.delta",
      data: { turnId, messageId, text },
    }) as GuideEvent,
  ally: (seq: number, messageId: string, text: string, turnId = "u1") =>
    ({
      ...base(seq, true),
      type: "assistant.message",
      data: { messageId, turnId, text, channel: "text" },
    }) as GuideEvent,
  card: (seq: number, card: Partial<GuideCard> & { cardId: string }) =>
    ({
      ...base(seq, true),
      type: "card.presented",
      data: {
        card: {
          kind: "course_item",
          presentation: "shelf",
          state: "ready",
          title: "Opening a call",
          ...card,
        },
      },
    }) as GuideEvent,
  cardUpdated: (seq: number, cardId: string, state: GuideCard["state"]) =>
    ({ ...base(seq, true), type: "card.updated", data: { cardId, state } }) as GuideEvent,
  started: (seq: number, turnId = "u1") =>
    ({
      ...base(seq, false),
      type: "turn.started",
      data: { turnId, trigger: "learner_message" },
    }) as GuideEvent,
  completed: (seq: number, turnId = "u1") =>
    ({ ...base(seq, false), type: "turn.completed", data: { turnId } }) as GuideEvent,
  failed: (seq: number, code: string, turnId: string | null = "u1") =>
    ({
      ...base(seq, false),
      type: "turn.failed",
      data: { turnId, code, message: "x" },
    }) as GuideEvent,
  mode: (seq: number, mode: string, atmosphere: string) =>
    ({ ...base(seq, true), type: "mode.changed", data: { mode, atmosphere } }) as GuideEvent,
  crisis: (seq: number) =>
    ({
      ...base(seq, true),
      type: "crisis.response",
      data: {
        messageId: "crisis-1",
        text: "fixed",
        language: "en",
        lines: [{ name: "Tele-MANAS", phone: "14416" }],
      },
    }) as GuideEvent,
  sceneOpened: (seq: number, sceneId: string) =>
    ({
      ...base(seq, true),
      type: "scene.opened",
      data: { sceneId, sectionId: "s1", title: "Chapter 1", stakes: "Meera calls." },
    }) as GuideEvent,
  sceneClosed: (seq: number, sceneId: string) =>
    ({
      ...base(seq, true),
      type: "scene.closed",
      data: {
        sceneId,
        sectionId: "s1",
        receipt: { behaviourLabels: ["Stayed with silence"], sideQuests: 1 },
      },
    }) as GuideEvent,
};

const fold = (
  events: GuideEvent[],
  state: GuideFeedState = { ...initialFeedState, threadId: "t1" },
) => events.reduce((s, event) => guideFeedReducer(s, { type: "event", event }), state);

const bootstrap = (overrides: Partial<JourneyBootstrap> = {}): JourneyBootstrap => ({
  availability: {
    guided: true,
    anonymousChat: false,
    voice: false,
    languages: ["en"],
    reason: null,
  },
  access: { hasAccess: true, enrolled: true, reason: null },
  thread: { id: "t1", mode: "NORMAL", atmosphere: "bright", lastEventSeq: 5 },
  course: {
    id: "c1",
    title: "Course",
    description: null,
    coverImageUrl: null,
    estimatedMinutes: null,
    languageCode: "en",
  },
  spine: [],
  progress: { currentItemId: "i2", completedItems: 1, totalItems: 4 },
  messages: [],
  cards: [],
  prefs: { guidance: "walk" },
  nextStep: null,
  crisis: null,
  allowance: null,
  scenes: [],
  complete: true,
  ...overrides,
});

describe("guideFeedReducer", () => {
  it("folds every contract fixture event without throwing", () => {
    const state = fold(fixtureEvents());
    expect(state.lastSeq).toBe(12);
    expect(state.mode).toBe("CARE");
    expect(state.crisis?.lines[0].phone).toBe("14416");
  });

  it("streams deltas into one Ally message, then settles it on assistant.message", () => {
    let state = fold([ev.started(1), ev.delta(1, "m2", "Hi"), ev.delta(1, "m2", ", I'm")]);
    const draft = state.entries[0];
    expect(draft).toMatchObject({ kind: "message", status: "streaming", text: "Hi, I'm" });

    state = fold([ev.ally(2, "m2", "Hi, I'm Ally."), ev.completed(2)], state);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ status: "final", text: "Hi, I'm Ally.", seq: 2 });
    expect(state.activeTurnId).toBeNull();
  });

  it("ignores a durable event it has already applied (replay after reconnect)", () => {
    const once = fold([ev.ally(1, "m1", "Hello"), ev.card(2, { cardId: "k1" })]);
    const twice = fold([ev.ally(1, "m1", "Hello"), ev.card(2, { cardId: "k1" })], once);
    expect(twice.entries).toHaveLength(2);
    expect(twice).toBe(once);
  });

  it("swaps the optimistic echo for the stored message in place", () => {
    let state = guideFeedReducer(
      { ...initialFeedState, threadId: "t1" },
      { type: "learner/echo", clientTurnId: "c1", text: "What does this cover?" },
    );
    state = fold([ev.ally(1, "m0", "Earlier line")], state);
    expect(state.entries.map(e => e.id)).toEqual(["echo:c1", "m0"]);

    state = fold([ev.learner(2, "m3", "What does this cover?", "c1")], state);
    expect(state.entries.map(e => e.id)).toEqual(["m3", "m0"]);
    expect(state.entries[0]).toMatchObject({ status: "final", role: "learner" });
  });

  it("appends a learner message from another tab (no matching echo)", () => {
    const state = fold([ev.learner(1, "m1", "from the phone", "other-tab")]);
    expect(state.entries).toHaveLength(1);
  });

  it("marks the learner's echo failed and drops the half-streamed reply when a turn fails", () => {
    let state = guideFeedReducer(
      { ...initialFeedState, threadId: "t1" },
      { type: "learner/echo", clientTurnId: "c1", text: "Tell me more" },
    );
    state = guideFeedReducer(state, { type: "learner/accepted", clientTurnId: "c1", turnId: "u1" });
    state = fold([ev.started(0), ev.delta(0, "m2", "Partial")], state);
    state = fold([ev.failed(0, "internal_error")], state);

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ status: "failed", clientTurnId: "c1" });
    expect(state.failure).toMatchObject({ code: "internal_error", clientTurnId: "c1" });
    expect(failureRetryText(state)).toBe("Tell me more");
  });

  it("finds the retry text for a failure after the server stored the message", () => {
    const state = fold([
      ev.learner(1, "m1", "Why this?", "c1"),
      ev.failed(1, "provider_unavailable"),
    ]);
    expect(failureRetryText(state)).toBe("Why this?");
  });

  it("keeps card state the server's: card.updated moves it, unknown cards are ignored", () => {
    let state = fold([ev.card(1, { cardId: "k1" })]);
    state = fold([ev.cardUpdated(2, "k1", "done"), ev.cardUpdated(3, "nope", "done")], state);
    expect(state.cards.k1.state).toBe("done");
    expect(state.cards.nope).toBeUndefined();
  });

  it("opens only one player at a time", () => {
    let state = fold([ev.card(1, { cardId: "k1" }), ev.card(2, { cardId: "k2" })]);
    state = guideFeedReducer(state, { type: "card/open", cardId: "k1" });
    state = guideFeedReducer(state, { type: "card/open", cardId: "k2" });
    expect(state.activeCardId).toBe("k2");
    state = guideFeedReducer(state, { type: "card/close", cardId: "k1" });
    expect(state.activeCardId).toBe("k2");
    state = guideFeedReducer(state, { type: "card/close" });
    expect(state.activeCardId).toBeNull();
  });

  it("in a crisis: drops streaming text, closes the open card, pins the crisis card", () => {
    let state = fold([ev.card(1, { cardId: "k1" })]);
    state = guideFeedReducer(state, { type: "card/open", cardId: "k1" });
    state = fold(
      [ev.started(1), ev.delta(1, "m2", "Some reply"), ev.mode(2, "CRISIS", "still"), ev.crisis(3)],
      state,
    );

    expect(state.activeCardId).toBeNull();
    expect(state.entries.some(e => e.kind === "message" && e.status === "streaming")).toBe(false);
    expect(state.entries.at(-1)).toMatchObject({ kind: "crisis", id: "crisis-1" });
    expect(guideFeedReducer(state, { type: "card/open", cardId: "k1" }).activeCardId).toBeNull();
  });

  it("folds the crisis card into a Support chip once the thread leaves CRISIS", () => {
    const state = fold([ev.mode(1, "CRISIS", "still"), ev.crisis(2), ev.mode(3, "CARE", "hushed")]);
    expect(state.supportPinned).toBe(true);
    expect(state.atmosphere).toBe("hushed");
  });

  it("tracks scenes and tags entries with the scene they belong to", () => {
    const state = fold([
      ev.sceneOpened(1, "sc1"),
      ev.ally(2, "m1", "Welcome to chapter one"),
      ev.sceneClosed(3, "sc1"),
      ev.ally(4, "m2", "Between scenes"),
    ]);
    expect(state.scenes.sc1).toMatchObject({ closed: true, title: "Chapter 1" });
    expect(state.entries.map(e => [e.kind, "sceneId" in e ? e.sceneId : null])).toEqual([
      ["scene", "sc1"],
      ["message", "sc1"],
      ["receipt", "sc1"],
      ["message", null],
    ]);
  });

  it("hydrates a complete bootstrap in seq order and resumes after its last seq", () => {
    const state = guideFeedReducer(initialFeedState, {
      type: "hydrate",
      bootstrap: bootstrap({
        messages: [
          {
            id: "m1",
            seq: 1,
            role: "ally",
            kind: "chat",
            text: "Hi",
            turnId: null,
            createdAt: null,
          },
          {
            id: "m3",
            seq: 3,
            role: "learner",
            kind: "chat",
            text: "Ok",
            turnId: null,
            createdAt: null,
          },
        ],
        cards: [
          {
            cardId: "k1",
            kind: "course_item",
            presentation: "inline",
            state: "done",
            title: "Quiz",
            seq: 2,
          },
        ],
      }),
    });
    expect(state.entries.map(e => e.id)).toEqual(["m1", "k1", "m3"]);
    expect(state.cards.k1.state).toBe("done");
    expect(state.lastSeq).toBe(5);
    // The Spine starts where the server says the learner is.
    expect(state.progress).toEqual({ currentItemId: "i2", completedItems: 1, totalItems: 4 });
    // Anything at or below 5 is already in the bootstrap.
    expect(fold([ev.ally(4, "m4", "dup")], state).entries).toHaveLength(3);
  });

  it("restores the crisis card from bootstrap on a reload during CRISIS", () => {
    const state = guideFeedReducer(initialFeedState, {
      type: "hydrate",
      bootstrap: bootstrap({
        thread: { id: "t1", mode: "CRISIS", atmosphere: "still", lastEventSeq: 9 },
        crisis: {
          messageId: "c9",
          text: "fixed message",
          language: "en",
          lines: [{ name: "Tele-MANAS", phone: "14416" }],
        },
      }),
    });
    expect(state.mode).toBe("CRISIS");
    expect(state.crisis).toMatchObject({ messageId: "c9", text: "fixed message" });
    expect(state.crisis?.lines[0].phone).toBe("14416");
  });

  it("hydrates an incomplete bootstrap empty so the stream replays from 0", () => {
    const state = guideFeedReducer(initialFeedState, {
      type: "hydrate",
      bootstrap: bootstrap({
        complete: false,
        messages: [
          {
            id: "m1",
            seq: 1,
            role: "ally",
            kind: "chat",
            text: "Hi",
            turnId: null,
            createdAt: null,
          },
        ],
      }),
    });
    expect(state.entries).toEqual([]);
    expect(state.lastSeq).toBe(0);
    expect(state.threadId).toBe("t1");
  });

  it("ignores events for another thread", () => {
    const other = { ...ev.ally(1, "m1", "x"), threadId: "t2" } as GuideEvent;
    expect(fold([other]).entries).toEqual([]);
  });

  it("lists queued echoes for the offline queue", () => {
    let state = guideFeedReducer(initialFeedState, {
      type: "learner/echo",
      clientTurnId: "c1",
      text: "offline one",
      status: "queued",
    });
    state = guideFeedReducer(state, { type: "learner/echo", clientTurnId: "c2", text: "sent" });
    expect(queuedEchoes(state).map(e => e.clientTurnId)).toEqual(["c1"]);
  });

  it("knows when Ally has just answered (for 'That's not what I meant')", () => {
    const state = fold([ev.learner(1, "m1", "q", null), ev.ally(2, "m2", "a")]);
    expect(lastAllyMessage(state)?.id).toBe("m2");
    expect(lastAllyMessage(fold([ev.learner(3, "m3", "again", null)], state))).toBeNull();
  });

  describe("anonymous visitors (M2)", () => {
    const echo = (state: GuideFeedState, clientTurnId: string, text: string) =>
      guideFeedReducer(state, { type: "learner/echo", clientTurnId, text });

    it("takes the visitor's thread when their first message opens it", () => {
      const state = guideFeedReducer(initialFeedState, {
        type: "thread/opened",
        thread: { id: "t9", mode: "NORMAL", atmosphere: "bright", lastEventSeq: 3 },
      });
      expect(state).toMatchObject({ threadId: "t9", lastSeq: 3 });
    });

    it("on a sign-in refusal, drops the words from the feed and holds them for after sign-in", () => {
      let state = { ...initialFeedState, threadId: "t1", allowance: { remaining: 1, limit: 5 } };
      state = echo(state, "c1", "One more thing");
      state = guideFeedReducer(state, {
        type: "learner/accepted",
        clientTurnId: "c1",
        turnId: "u1",
      });
      state = fold([ev.failed(0, "allowance_exhausted")], state);

      expect(state.entries).toHaveLength(0);
      expect(state.heldText).toBe("One more thing");
      expect(state.allowance).toEqual({ remaining: 0, limit: 5 });
      expect(state.failure).toMatchObject({ code: "allowance_exhausted", clientTurnId: null });

      state = guideFeedReducer(state, { type: "held/consumed" });
      expect(state.heldText).toBeNull();
    });

    it("matches a refusal that beats the 202 to the newest echo without a turn", () => {
      let state = echo({ ...initialFeedState, threadId: "t1" }, "c1", "Hello?");
      state = fold([ev.failed(0, "anonymous_paused", "u7")], state);
      expect(state.entries).toHaveLength(0);
      expect(state.heldText).toBe("Hello?");
      // The late 202 finds nothing to update.
      const after = guideFeedReducer(state, {
        type: "learner/accepted",
        clientTurnId: "c1",
        turnId: "u7",
      });
      expect(after.entries).toHaveLength(0);
    });

    it("a late 202 leaves a failed echo failed", () => {
      let state = echo({ ...initialFeedState, threadId: "t1" }, "c1", "Hi");
      state = fold([ev.failed(0, "internal_error", "u1")], state);
      expect(state.entries[0]).toMatchObject({ status: "failed" });
      state = guideFeedReducer(state, {
        type: "learner/accepted",
        clientTurnId: "c1",
        turnId: "u1",
      });
      expect(state.entries[0]).toMatchObject({ status: "failed", turnId: "u1" });
    });

    it("a re-hydrate after sign-in keeps what's waiting to be sent, and the held words", () => {
      let state = guideFeedReducer(initialFeedState, {
        type: "learner/echo",
        clientTurnId: "q1",
        text: "typed while signing in",
        status: "queued",
      });
      state = { ...state, heldText: "held" };
      const kept = guideFeedReducer(state, {
        type: "hydrate",
        bootstrap: bootstrap(),
        keepQueued: true,
      });
      expect(queuedEchoes(kept).map(e => e.text)).toEqual(["typed while signing in"]);
      expect(kept.heldText).toBe("held");

      const fresh = guideFeedReducer(state, { type: "hydrate", bootstrap: bootstrap() });
      expect(queuedEchoes(fresh)).toHaveLength(0);
      expect(fresh.heldText).toBeNull();
    });

    it("hydrates the allowance and follows the allowance event", () => {
      let state = guideFeedReducer(initialFeedState, {
        type: "hydrate",
        bootstrap: bootstrap({ allowance: { remaining: 3, limit: 5 } }),
      });
      expect(state.allowance).toEqual({ remaining: 3, limit: 5 });
      state = fold(
        [{ ...base(0, false), type: "allowance", data: { remaining: 2, limit: 5 } } as GuideEvent],
        state,
      );
      expect(state.allowance).toEqual({ remaining: 2, limit: 5 });
    });
  });

  it("regroups the feed by chapter scene on reload: title cards, receipts, and who belongs where", () => {
    const state = guideFeedReducer(initialFeedState, {
      type: "hydrate",
      bootstrap: bootstrap({
        thread: { id: "t1", mode: "NORMAL", atmosphere: "bright", lastEventSeq: 9 },
        scenes: [
          {
            sceneId: "sc1",
            sectionId: "s1",
            title: "Opening",
            stakes: "Meera calls.",
            openedSeq: 1,
            closedSeq: 5,
            receipt: { behaviourLabels: ["Stayed with silence"], sideQuests: 1 },
          },
          {
            sceneId: "sc2",
            sectionId: "s2",
            title: "Listening",
            stakes: null,
            openedSeq: 6,
            closedSeq: null,
          },
        ],
        messages: [
          { id: "m1", seq: 2, role: "ally", kind: "chat", text: "Hi", turnId: "u1", createdAt: "" },
          {
            id: "m2",
            seq: 7,
            role: "ally",
            kind: "chat",
            text: "Next",
            turnId: "u2",
            createdAt: "",
          },
        ],
        cards: [
          {
            seq: 3,
            cardId: "c1",
            kind: "course_item",
            presentation: "shelf",
            state: "done",
            title: "Opening a call",
          },
        ],
      }),
    });
    expect(state.entries.map(e => `${e.kind}:${e.id}`)).toEqual([
      "scene:scene:sc1",
      "message:m1",
      "card:c1",
      "receipt:receipt:sc1",
      "scene:scene:sc2",
      "message:m2",
    ]);
    expect(state.entries.map(e => ("sceneId" in e ? e.sceneId : null))).toEqual([
      "sc1",
      "sc1",
      "sc1",
      "sc1",
      "sc2",
      "sc2",
    ]);
    expect(state.scenes.sc1).toMatchObject({ closed: true, receipt: { sideQuests: 1 } });
    expect(state.scenes.sc2).toMatchObject({ closed: false, receipt: null });
    expect(state.currentSceneId).toBe("sc2");
  });
});
