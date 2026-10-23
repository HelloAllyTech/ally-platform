import { describe, expect, it } from "vitest";

import { TrackAccessDenialReason, TrackDetail, TrackItemStatus, TrackItemType } from "@types";

import { composeBootstrap, fromBootstrapWire } from "../bootstrap";

describe("fromBootstrapWire", () => {
  it("reads the bootstrap shape and fills safe defaults", () => {
    const view = fromBootstrapWire("track-1", {
      availability: { guided: true, languages: ["en", "hi"], reason: null },
      access: { hasAccess: true, enrolled: false, reason: null },
      thread: { id: "t1", mode: "CARE", atmosphere: "hushed", lastEventSeq: 7 },
      course: { title: "Foundations", estimatedDurationMinutes: 40 },
      spine: {
        sections: [
          {
            id: "s1",
            title: "Opening",
            items: [
              { id: "i1", type: "ROLEPLAY", title: "Meera calls", state: "UNLOCKED" as never },
              {
                id: "i2",
                type: "ARTICLE",
                title: "Opening a call",
                state: "completed" as never,
                hasWarnings: true,
              },
            ],
          },
        ],
      },
      cards: [
        { cardId: "k1", kind: "course_item", presentation: "inline", state: "done", title: "Quiz" },
      ],
      prefs: { guidance: "bogus" as never },
    });

    expect(view.availability).toEqual({
      guided: true,
      anonymousChat: false,
      voice: false,
      languages: ["en", "hi"],
      reason: null,
    });
    expect(view.thread).toEqual({ id: "t1", mode: "CARE", atmosphere: "hushed", lastEventSeq: 7 });
    expect(view.course).toMatchObject({
      id: "track-1",
      title: "Foundations",
      estimatedMinutes: 40,
    });
    expect(view.spine[0].items[0]).toMatchObject({
      state: "available",
      boss: true,
      tension: "high",
    });
    expect(view.spine[0].items[1]).toMatchObject({ state: "done", boss: false, hasWarnings: true });
    expect(view.prefs.guidance).toBe("walk");
    expect(view.complete).toBe(true);
  });

  it("accepts a thread-less bootstrap (first visit)", () => {
    const view = fromBootstrapWire("track-1", { thread: null });
    expect(view.thread).toBeNull();
    expect(view.access.hasAccess).toBe(false);
  });
});

describe("composeBootstrap", () => {
  const detail = {
    id: "track-1",
    title: "Foundations",
    description: null,
    coverImageUrl: null,
    status: "PUBLISHED",
    totalItems: 2,
    simulationsCount: 0,
    estimatedDurationMinutes: 30,
    enrolled: true,
    trackEnrollmentId: "e1",
    completedItems: 1,
    completedAt: null,
    sections: [
      {
        id: "s1",
        title: "Opening",
        description: null,
        order: 0,
        items: [
          {
            id: "i1",
            type: TrackItemType.VIDEO,
            order: 0,
            title: "Watch",
            status: TrackItemStatus.COMPLETED,
            contentMeta: { durationSeconds: 360 },
          },
          {
            id: "i2",
            type: TrackItemType.CASE,
            order: 1,
            title: "Case",
            status: TrackItemStatus.UNLOCKED,
            contentMeta: null,
          },
        ],
      },
    ],
  } as unknown as TrackDetail;

  it("builds the spine and next step from the classic course detail", () => {
    const view = composeBootstrap({
      trackId: "track-1",
      availability: { guided: true },
      access: { hasAccess: true, enrolled: true, reason: null },
      thread: { id: "t1", mode: "NORMAL", atmosphere: "bright", lastEventSeq: 3 },
      detail,
    });
    expect(view.spine[0].items.map(i => [i.id, i.state, i.minutes, i.boss])).toEqual([
      ["i1", "done", 6, false],
      ["i2", "available", null, true],
    ]);
    expect(view.nextStep).toEqual({ hidden: false, itemId: "i2", title: "Case", minutes: null });
    expect(view.complete).toBe(false);
    expect(view.cards).toEqual([]);
  });

  it("carries a denial through untouched", () => {
    const view = composeBootstrap({
      trackId: "track-1",
      availability: { guided: true },
      access: { hasAccess: false, enrolled: false, reason: TrackAccessDenialReason.NOT_IN_GROUP },
      thread: null,
      detail: null,
    });
    expect(view.access.reason).toBe("NOT_IN_GROUP");
    expect(view.spine).toEqual([]);
    expect(view.nextStep).toBeNull();
  });
});
