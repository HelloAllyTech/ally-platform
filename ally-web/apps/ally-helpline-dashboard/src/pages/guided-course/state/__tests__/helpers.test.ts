import { describe, expect, it } from "vitest";

import en from "../../../../i18n/locales/en.json";
import { buildIcs, slotTime } from "../../cards/special/appointment";
import { crisisLinesFor } from "../../cards/special/CrisisCard";
import { safetyCopyFor } from "../../copy/safetyCopy";
import { breathPhaseAt } from "../../presence/BreatheWithMe";
import { FAILURE_STATES } from "../failureStates";
import type { FeedEntry, SceneState } from "../guideFeedReducer";
import { firstCardInScene, visibleEntries } from "../sceneGrouping";

const scene = (sceneId: string, closed: boolean): SceneState => ({
  sceneId,
  sectionId: `s-${sceneId}`,
  title: sceneId,
  stakes: null,
  closed,
  receipt: closed ? { behaviourLabels: [], sideQuests: 0 } : null,
});

const entries: FeedEntry[] = [
  { kind: "scene", id: "scene:a", seq: 1, sceneId: "a" },
  {
    kind: "message",
    id: "m1",
    role: "ally",
    text: "x",
    status: "final",
    turnId: null,
    clientTurnId: null,
    seq: 2,
    sceneId: "a",
  },
  { kind: "card", id: "k1", seq: 3, sceneId: "a" },
  { kind: "receipt", id: "receipt:a", seq: 4, sceneId: "a" },
  {
    kind: "message",
    id: "m2",
    role: "ally",
    text: "y",
    status: "final",
    turnId: null,
    clientTurnId: null,
    seq: 5,
    sceneId: null,
  },
  { kind: "crisis", id: "c1", seq: 6 },
];

describe("scene collapse", () => {
  it("folds a closed scene to its receipt", () => {
    const visible = visibleEntries(entries, { a: scene("a", true) }, new Set());
    expect(visible.map(e => e.id)).toEqual(["receipt:a", "m2"]);
  });

  it("shows everything in an expanded closed scene", () => {
    const visible = visibleEntries(entries, { a: scene("a", true) }, new Set(["a"]));
    expect(visible.map(e => e.id)).toEqual(["scene:a", "m1", "k1", "receipt:a", "m2"]);
  });

  it("never folds an open scene, and keeps the crisis card out of the flow", () => {
    const visible = visibleEntries(entries, { a: scene("a", false) }, new Set());
    expect(visible.map(e => e.id)).toEqual(["scene:a", "m1", "k1", "receipt:a", "m2"]);
  });

  it("hides the empty learner message an intent-only turn leaves behind", () => {
    const withIntent: FeedEntry[] = [
      ...entries,
      {
        kind: "message",
        id: "m3",
        role: "learner",
        text: "  ",
        status: "final",
        turnId: "u3",
        clientTurnId: null,
        seq: 7,
        sceneId: null,
      },
    ];
    expect(
      visibleEntries(withIntent, { a: scene("a", false) }, new Set()).map(e => e.id),
    ).not.toContain("m3");
  });

  it("finds a scene's first card for Skip intro", () => {
    expect(firstCardInScene(entries, "a")).toBe("k1");
    expect(firstCardInScene(entries, "b")).toBeNull();
  });
});

describe("appointment slots", () => {
  // Wednesday 21 Oct 2026, 20:30 local.
  const now = new Date(2026, 9, 21, 20, 30);

  it("tomorrow morning is 9:00 tomorrow", () => {
    const at = slotTime("tomorrowMorning", now)!;
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([22, 9, 0]);
  });

  it("after my shift is today if the shift end is still ahead, else tomorrow", () => {
    expect(slotTime("afterShift", now, "22:00")!.getDate()).toBe(21);
    expect(slotTime("afterShift", now, "18:00")!.getDate()).toBe(22);
    expect(slotTime("afterShift", now, null)).toBeNull();
  });

  it("this weekend is the coming Saturday at 10:00", () => {
    const at = slotTime("weekend", now)!;
    expect([at.getDay(), at.getHours()]).toEqual([6, 10]);
    const saturday = new Date(2026, 9, 24, 8, 0);
    expect(slotTime("weekend", saturday)!.getDate()).toBe(31);
  });

  it("a custom time needs the picker", () => {
    expect(slotTime("custom", now)).toBeNull();
  });

  it("builds a one-event calendar file on the device", () => {
    const ics = buildIcs({
      start: new Date(Date.UTC(2026, 9, 22, 3, 30)),
      title: "Ally: course, part 1",
      url: "https://x/journey/t",
      uid: "k@ally",
    });
    expect(ics).toContain("DTSTART:20261022T033000Z");
    expect(ics).toContain("DTEND:20261022T040000Z");
    expect(ics).toContain("SUMMARY:Ally: course\\, part 1");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});

describe("crisis lines", () => {
  it("falls back to the platform lines, with 112 always present", () => {
    expect(crisisLinesFor([]).map(l => l.phone)).toEqual(["14416", "112"]);
    expect(
      crisisLinesFor([{ name: "Org line", phone: "+91 98000 00000" }]).map(l => l.phone),
    ).toEqual(["+91 98000 00000", "112"]);
  });

  it("shows only reviewed languages and falls back to English", () => {
    expect(safetyCopyFor("hi").crisisTitle).toBe(safetyCopyFor("en").crisisTitle);
    expect(safetyCopyFor(undefined).safeNow).toBe("I'm safe right now");
  });
});

describe("breathe with me", () => {
  it("paces four in, six out, four rounds", () => {
    expect(breathPhaseAt(0)).toEqual({ round: 1, phase: "in", count: 1 });
    expect(breathPhaseAt(3)).toEqual({ round: 1, phase: "in", count: 4 });
    expect(breathPhaseAt(4)).toEqual({ round: 1, phase: "out", count: 1 });
    expect(breathPhaseAt(9)).toEqual({ round: 1, phase: "out", count: 6 });
    expect(breathPhaseAt(10)).toEqual({ round: 2, phase: "in", count: 1 });
    expect(breathPhaseAt(40).phase).toBe("done");
  });
});

describe("failure copy", () => {
  const get = (path: string) =>
    path
      .split(".")
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], en);

  it("has an English line for every designed failure state", () => {
    for (const state of Object.values(FAILURE_STATES)) {
      expect(typeof get(state.copyKey), state.copyKey).toBe("string");
    }
  });

  it("never shows an error code or the word 'error' to the learner", () => {
    const failure = (en as { guide: { failure: Record<string, string> } }).guide.failure;
    for (const line of Object.values(failure)) {
      expect(line).not.toMatch(/error|\b[45]\d\d\b|[A-Z]{3,}_[A-Z]+/);
      expect(line).not.toContain("!");
    }
  });
});
