import "@constants";

import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { BuilderChatMessage, BuilderServerMessage } from "@types";

import { agoText, dueSoon, newlyMet } from "../drafts/draftUtils";
import { findQuote } from "../drafts/HighlightedTextBox";
import { dictationErrorState, extensionFor, formatClock, typeInText } from "../hooks/useDictation";
import { mentionAt, mentionedIds } from "../session/CommentBox";
import { commentAnchors, isPlanPost, planStartFeedIndex, serverIdOf } from "../session/sessionFeed";
import { declineTemplates } from "../triage/DeclineDialog";
import { leadWhy, orderCandidates } from "../triage/LeadPicker";
import { swipeDecision, workingDaysSince } from "../triage/triageUtils";
import {
  __resetDeviceStoreForTests,
  deviceAll,
  deviceDelete,
  deviceGet,
  deviceSet,
  isOfflineError,
  newIdempotencyKey,
} from "../utils/deviceStore";

import type { RoadmapDraftCheck, RoadmapLeadCandidate } from "../../../types/roadmapV2Flow";

const check = (id: RoadmapDraftCheck["id"], met: boolean): RoadmapDraftCheck => ({
  id,
  label: id,
  hint: "",
  met,
  source: met ? "agent" : null,
  evidence: met ? { quote: "new learners", from: "text" } : null,
  note: null,
  reopened: false,
});

describe("findQuote (the source-sentence highlight)", () => {
  it("finds a quote ignoring case, curly quotes and runs of whitespace", () => {
    const text = "Learners drop off after their FIRST   roleplay because it’s hard.";
    const range = findQuote(text, "after their first roleplay because it's hard.");
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end)).toBe(
      "after their FIRST   roleplay because it’s hard",
    );
  });

  it("returns null for a paraphrase", () => {
    expect(findQuote("Learners drop off.", "people leave")).toBeNull();
    expect(findQuote("anything", "   ")).toBeNull();
  });
});

describe("draft helpers", () => {
  it("newlyMet lists only checks that just turned met", () => {
    const before = [check("who_it_affects", true), check("outcome", false)];
    const after = [check("who_it_affects", true), check("outcome", true)];
    expect(newlyMet(before, after).map(c => c.id)).toEqual(["outcome"]);
    expect(newlyMet(after, before)).toEqual([]);
  });

  it("agoText says how long ago, in the plan's words", () => {
    const now = 1_000_000_000;
    expect(agoText(now - 2_000, now)).toBe(en.roadmapV2.draft.ago.now);
    expect(agoText(now - 12_000, now)).toBe(en.roadmapV2.draft.ago.seconds(12));
    expect(agoText(now - 3 * 60_000, now)).toBe(en.roadmapV2.draft.ago.minutes(3));
    expect(agoText(now - 2 * 3_600_000, now)).toBe(en.roadmapV2.draft.ago.hours(2));
  });

  it("dueSoon warns seven days before an archive or purge date", () => {
    const now = Date.UTC(2026, 10, 17);
    expect(dueSoon(new Date(now + 6 * 86_400_000).toISOString(), now)).toBe(true);
    expect(dueSoon(new Date(now + 8 * 86_400_000).toISOString(), now)).toBe(false);
    expect(dueSoon(null, now)).toBe(false);
  });
});

describe("dictation helpers", () => {
  it("formats the recording clock", () => {
    expect(formatClock(7_400)).toBe("0:07");
    expect(formatClock(119_999)).toBe("1:59");
  });

  it("names the clip from its real MIME type", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("maps the idea cap to its own state and anything else to failed", () => {
    expect(dictationErrorState({ status: 409, data: { code: "idea_cap_reached" } })).toBe(
      "capReached",
    );
    expect(dictationErrorState({ status: 502, data: { code: "transcription_failed" } })).toBe(
      "failed",
    );
  });

  it("types the words in (or lands them at once under reduced motion) with a space between", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    typeInText("Learners drop off", "after their first roleplay", apply, false);
    vi.advanceTimersByTime(400);
    expect(apply).toHaveBeenLastCalledWith("Learners drop off after their first roleplay");
    const reducedApply = vi.fn();
    typeInText("Hi", "there everyone here", reducedApply, true);
    expect(reducedApply).toHaveBeenCalledTimes(1);
    expect(reducedApply).toHaveBeenCalledWith("Hi there everyone here");
    vi.useRealTimers();
  });
});

describe("triage helpers", () => {
  it("counts working days, skipping weekends", () => {
    // Friday 2026-11-13 → Wednesday 2026-11-18: Mon, Tue, Wed.
    const friday = new Date(2026, 10, 13, 10).toISOString();
    expect(workingDaysSince(friday, new Date(2026, 10, 18, 9).getTime())).toBe(3);
    expect(workingDaysSince(undefined)).toBe(0);
  });

  it("a swipe commits past 40% of the width and springs back short of it", () => {
    expect(swipeDecision(161, 400)).toBe("pickLead");
    expect(swipeDecision(-161, 400)).toBe("decline");
    expect(swipeDecision(150, 400)).toBeNull();
    expect(swipeDecision(-100, 400)).toBeNull();
  });

  it("decline templates suggest the overlap first, and name the goal", () => {
    const t = en.roadmapV2.review.templates;
    expect(declineTemplates("OPP-212", "Learner return")).toEqual([
      t.overlaps("OPP-212"),
      t.evidence,
      t.goals("Learner return"),
      t.tooSmall,
    ]);
    expect(declineTemplates()[0]).toBe(t.overlapsGeneric);
  });

  it("puts the suggested lead first and explains why", () => {
    const c = (
      id: number,
      score: number,
      extra: Partial<RoadmapLeadCandidate> = {},
    ): RoadmapLeadCandidate => ({
      user: { id, name: `P${id}`, role: "builder" },
      leading: 1,
      limit: 3,
      freeSlots: 2,
      appsTouched: ["admin"],
      matchingIdeas: 4,
      score,
      ...extra,
    });
    const ordered = orderCandidates([c(1, 90), c(2, 50), c(3, 70)], 2);
    expect(ordered.map(x => x.user.id)).toEqual([2, 1, 3]);
    expect(leadWhy(c(1, 1))).toBe("2 of 3 slots free · built 4 admin ideas");
    expect(leadWhy(c(1, 1, { matchingIdeas: 0 }))).toBe("2 of 3 slots free");
  });
});

describe("comments and mentions", () => {
  it("finds the @word at the caret", () => {
    expect(mentionAt("Thanks @pri", 11)).toEqual({ query: "pri", start: 7 });
    expect(mentionAt("email a@b", 9)).toBeNull();
  });

  it("collects mentioned people still named in the text", () => {
    const people = [
      { id: 1, name: "Priya", role: "builder" as const },
      { id: 2, name: "Ana", role: "idea" as const },
    ];
    expect(mentionedIds("@Priya can you look?", people)).toEqual([1]);
  });

  it("places each comment before the first turn written after it", () => {
    const feed = [
      { id: "srv_a", role: "assistant", content: "x" },
      { id: "srv_b_q_q1", role: "assistant", content: "" },
    ] as BuilderChatMessage[];
    const meta = new Map([
      ["a", { createdAt: "2026-11-01T10:00:00Z" }],
      ["b", { createdAt: "2026-11-01T12:00:00Z" }],
    ]);
    const post = (id: string, at: string) => ({
      id,
      seq: 1,
      kind: "comment" as const,
      text: id,
      by: { id: 1, name: "Ravi", role: "idea" as const },
      at,
      idempotencyKey: id,
    });
    const anchors = commentAnchors(feed, meta, [
      post("early", "2026-11-01T11:00:00Z"),
      post("late", "2026-11-02T00:00:00Z"),
    ]);
    expect(anchors.get("srv_b_q_q1")?.map(p => p.id)).toEqual(["early"]);
    expect(anchors.get(null)?.map(p => p.id)).toEqual(["late"]);
    expect(serverIdOf("srv_b_q_q1")).toBe("b");
  });

  it("marks where the plan interview starts, and hides plan posts from the turns", () => {
    const rows = [
      { id: "1", seq: 1, role: "assistant", content: "Who?", metadata: { planStage: "idea" } },
      { id: "2", seq: 2, role: "assistant", content: "Which learners?", metadata: {} },
    ] as unknown as BuilderServerMessage[];
    const feed = [
      { id: "srv_1", role: "assistant", content: "Who?" },
      { id: "srv_2", role: "assistant", content: "Which learners?" },
    ] as BuilderChatMessage[];
    expect(planStartFeedIndex(feed, rows)).toBe(1);
    expect(planStartFeedIndex(feed, [rows[1]])).toBe(-1);
    expect(isPlanPost({ ...rows[0], metadata: { planPost: { kind: "answer" } } } as never)).toBe(
      true,
    );
  });
});

describe("device store (IndexedDB first, localStorage here)", () => {
  afterEach(() => {
    __resetDeviceStoreForTests();
    window.localStorage.clear();
  });

  it("keeps a draft on the device and lists the outbox", async () => {
    await deviceSet("drafts", "OPP-1", { code: "OPP-1", text: "hello" });
    expect(await deviceGet("drafts", "OPP-1")).toEqual({ code: "OPP-1", text: "hello" });
    await deviceSet("outbox", "k1", { idempotencyKey: "k1" });
    expect(await deviceAll("outbox")).toEqual([{ idempotencyKey: "k1" }]);
    await deviceDelete("drafts", "OPP-1");
    expect(await deviceGet("drafts", "OPP-1")).toBeUndefined();
  });

  it("makes idempotency keys the server accepts (8..80 chars) and spots offline errors", () => {
    const key = newIdempotencyKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(80);
    expect(isOfflineError({ status: "FETCH_ERROR" })).toBe(true);
    expect(isOfflineError({ status: 503 })).toBe(false);
  });
});
