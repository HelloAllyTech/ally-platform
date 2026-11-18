import { describe, expect, it } from "vitest";

import type { BuilderDecision, BuilderNowSession } from "@types";

import {
  STALE_AFTER_MS,
  formatWait,
  groupSessions,
  reconcileQueue,
  serverOrder,
  waitTotals,
} from "../room/roomFormat";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const decision = (id: string, over: Partial<BuilderDecision> = {}): BuilderDecision =>
  ({
    id,
    kind: "question",
    category: "what",
    sessionId: `s-${id}`,
    sessionTitle: id,
    sessionStatus: "INTERVIEWING",
    createdByName: null,
    repos: [],
    prompt: id,
    rationale: null,
    questionType: null,
    context: [],
    blocked: "",
    selection: "single",
    options: [],
    allowCustom: true,
    allowNone: false,
    minSelections: null,
    customPlaceholder: null,
    waitingSince: ago(10),
    pullRequestUrl: null,
    ...over,
  }) as BuilderDecision;

const session = (id: string, over: Partial<BuilderNowSession> = {}): BuilderNowSession =>
  ({
    id,
    title: id,
    code: null,
    opportunityId: null,
    status: "BUILDING",
    currentStage: null,
    waitingOn: "builder",
    nowLine: "Writing code",
    waitingSince: null,
    stuckSince: null,
    pendingCount: 0,
    pendingKinds: [],
    putBackEligible: false,
    runSequence: null,
    pullRequests: [],
    createdByName: null,
    startedAt: ago(100),
    updatedAt: ago(1),
    ...over,
  }) as BuilderNowSession;

describe("formatWait", () => {
  it("reads like a wait", () => {
    expect(formatWait(30_000)).toBe("now");
    expect(formatWait(12 * 60_000)).toBe("12m");
    expect(formatWait(65 * 60_000)).toBe("1h 05m");
    expect(formatWait(45 * 86_400_000)).toBe("45d");
  });
});

describe("serverOrder", () => {
  it("orders by kind, then oldest, with stale waits last", () => {
    const stale = decision("stale", {
      waitingSince: new Date(NOW - STALE_AFTER_MS - 1).toISOString(),
    });
    const merge = decision("merge", { kind: "pr_merge", waitingSince: ago(5) });
    const q = decision("q", { waitingSince: ago(20) });
    expect(serverOrder([q, stale, merge], NOW).map(d => d.id)).toEqual(["merge", "q", "stale"]);
  });
});

describe("reconcileQueue", () => {
  it("never moves what is already on screen; arrivals join the end as fresh", () => {
    const first = reconcileQueue(null, [decision("a"), decision("b")], {
      now: NOW,
      focusedId: "a",
    });
    expect(first.order).toEqual(["a", "b"]);

    // A newer, higher-priority merge arrives: it does not jump the queue.
    const next = reconcileQueue(
      first,
      [decision("merge", { kind: "pr_merge" }), decision("a"), decision("b")],
      {
        now: NOW,
        focusedId: "a",
      },
    );
    expect(next.order).toEqual(["a", "b", "merge"]);
    expect(next.fresh).toEqual(["merge"]);
  });

  it("puts a follow-up from the session just answered straight after the card in focus", () => {
    const first = reconcileQueue(null, [decision("a"), decision("b"), decision("c")], {
      now: NOW,
      focusedId: "b",
    });
    const next = reconcileQueue(
      first,
      [decision("a"), decision("b"), decision("c"), decision("a2", { sessionId: "s-a" })],
      { now: NOW, focusedId: "b", lastAnswered: { sessionId: "s-a", at: NOW - 5_000 } },
    );
    expect(next.order).toEqual(["a", "b", "a2", "c"]);
  });

  it("keeps an answered or just-restored card in its place while the server stops listing it", () => {
    const first = reconcileQueue(null, [decision("a"), decision("b"), decision("c")], {
      now: NOW,
      focusedId: "b",
    });
    // b was answered: the server hides it during the undo window.
    const held = reconcileQueue(first, [decision("a"), decision("c")], {
      now: NOW,
      focusedId: "c",
      hidden: new Set(["b"]),
      keep: new Set(["b"]),
    });
    expect(held.order).toEqual(["a", "b", "c"]);
    // Undone: back in focus where it was, not a "new" arrival at the end.
    const back = reconcileQueue(held, [decision("a"), decision("b"), decision("c")], {
      now: NOW,
      focusedId: "b",
    });
    expect(back.order).toEqual(["a", "b", "c"]);
    expect(back.fresh).toEqual([]);
  });

  it("drops what the server no longer lists and hides answers inside the undo window", () => {
    const first = reconcileQueue(null, [decision("a"), decision("b")], {
      now: NOW,
      focusedId: "a",
    });
    const next = reconcileQueue(first, [decision("b"), decision("c")], {
      now: NOW,
      focusedId: "b",
      hidden: new Set(["c"]),
    });
    expect(next.order).toEqual(["b"]);
  });
});

describe("groupSessions and waitTotals", () => {
  it("groups in the fixed order, oldest wait first, stale last, empty groups left out", () => {
    const groups = groupSessions(
      [
        session("w"),
        session("young", { waitingOn: "you", waitingSince: ago(5) }),
        session("old", { waitingOn: "you", waitingSince: ago(50) }),
        session("stale", {
          waitingOn: "you",
          waitingSince: new Date(NOW - STALE_AFTER_MS - 1).toISOString(),
        }),
      ],
      NOW,
    );
    expect(groups.map(g => g.group)).toEqual(["you", "builder"]);
    expect(groups[0].sessions.map(s => s.id)).toEqual(["old", "young", "stale"]);
  });

  it("sums waits per session and keeps stale ones out of the total", () => {
    const totals = waitTotals(
      [
        session("a", { waitingOn: "you", waitingSince: ago(10) }),
        session("b", { waitingOn: "you", waitingSince: ago(20) }),
        session("c", {
          waitingOn: "you",
          waitingSince: new Date(NOW - STALE_AFTER_MS - 1).toISOString(),
        }),
        session("d", { waitingOn: "stuck" }),
        session("e", { waitingOn: "review" }),
      ],
      [decision("x"), decision("y")],
      NOW,
    );
    expect(totals).toMatchObject({
      count: 2,
      waitingMs: 30 * 60_000,
      stale: 1,
      stuck: 1,
      review: 1,
      working: 0,
    });
  });
});
