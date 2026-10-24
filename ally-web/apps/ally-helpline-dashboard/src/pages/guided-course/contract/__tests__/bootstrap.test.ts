import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TrackAccessDenialReason, TrackDetail, TrackItemStatus, TrackItemType } from "@types";

import { composeBootstrap, fromBootstrapWire, GuideBootstrapWire } from "../bootstrap";

const fixtures = resolve(__dirname, "../../../../../../../../ally-be/src/guide/contract/fixtures");
const [full, switchedOff] = JSON.parse(readFileSync(resolve(fixtures, "bootstrap.json"), "utf8"))
  .valid as GuideBootstrapWire[];

describe("fromBootstrapWire (contract fixtures)", () => {
  it("reads a full bootstrap: thread, course, Spine with progress, history and cards in seq order", () => {
    const view = fromBootstrapWire("tr-1", full);
    expect(view.availability).toMatchObject({
      guided: true,
      languages: ["en", "hi"],
      reason: null,
    });
    expect(view.access).toEqual({ hasAccess: true, enrolled: true, reason: null });
    expect(view.thread).toEqual({
      id: "th-1",
      mode: "NORMAL",
      atmosphere: "bright",
      lastEventSeq: 12,
    });
    expect(view.course).toMatchObject({
      id: "tr-1",
      title: "First calls",
      estimatedMinutes: 48,
      languageCode: "en",
    });
    expect(view.spine[0].items.map(i => [i.id, i.state, i.boss, i.hasWarnings])).toEqual([
      ["i1", "done", false, false],
      ["i2", "available", true, true],
    ]);
    expect(view.progress).toEqual({ currentItemId: "i2", completedItems: 1, totalItems: 2 });
    expect(view.messages.map(m => [m.id, m.role, m.text])).toEqual([
      ["m1", "learner", "Hi"],
      ["m2", "ally", "Hello."],
    ]);
    expect(view.cards[0]).toMatchObject({
      cardId: "c1",
      seq: 4,
      state: "ready",
      presentation: "theatre",
    });
    expect(view.prefs.guidance).toBe("walk");
    expect(view.crisis).toBeNull();
    expect(view.complete).toBe(true);
  });

  it("carries the crisis state while the thread is in CRISIS", () => {
    const crisis = {
      messageId: "c1",
      text: "fixed",
      language: "en",
      lines: [{ name: "Tele-MANAS", phone: "14416" }],
    };
    const view = fromBootstrapWire("tr-1", { ...full, crisis });
    expect(view.crisis).toEqual(crisis);
  });

  it("reads the switched-off shape: no access, course, Spine or thread", () => {
    const view = fromBootstrapWire("tr-1", switchedOff);
    expect(view.availability.guided).toBe(false);
    expect(view.access.hasAccess).toBe(false);
    expect(view.thread).toBeNull();
    expect(view.spine).toEqual([]);
    expect(view.progress).toBeNull();
    expect(view.course.id).toBe("tr-1");
  });

  it("fails closed on a malformed payload", () => {
    const view = fromBootstrapWire("tr-1", {
      availability: { guided: "yes" },
    } as unknown as GuideBootstrapWire);
    expect(view.availability.guided).toBe(false);
    expect(view.messages).toEqual([]);
    expect(view.cards).toEqual([]);
  });

  it("drops an unknown denial reason rather than passing it to the copy", () => {
    const view = fromBootstrapWire("tr-1", {
      ...switchedOff,
      access: { hasAccess: false, enrolled: false, reason: "SOMETHING_NEW" },
    });
    expect(view.access.reason).toBeNull();
    const known = fromBootstrapWire("tr-1", {
      ...switchedOff,
      access: { hasAccess: false, enrolled: false, reason: "NOT_IN_GROUP" },
    });
    expect(known.access.reason).toBe(TrackAccessDenialReason.NOT_IN_GROUP);
  });
});

describe("composeBootstrap (older backend)", () => {
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

  it("builds the Spine and next step from the classic course detail", () => {
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
    expect(view.progress).toBeNull();
  });
});
