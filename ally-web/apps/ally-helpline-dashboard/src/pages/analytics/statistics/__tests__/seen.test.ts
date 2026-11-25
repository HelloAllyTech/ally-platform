import { describe, expect, it } from "vitest";

import { SEEN_ROLL_MS, findingKey, readSeen, rollSeen, sinceVisit } from "../seen";

const at = (ms: number) => new Date(Date.UTC(2026, 10, 24, 10, 0, 0) + ms);
const live = (fingerprints: string[], active = 9, sessions = 200) => ({
  fingerprints,
  active,
  sessions,
});
const snap = (ms: number, findings: string[]) => ({
  at: at(ms).toISOString(),
  findings,
  active: 9,
  sessions: 200,
});

describe("findingKey", () => {
  it("drops the week, so the same problem next week is the same finding", () => {
    expect(findingKey("learners.dormant:2026-W48")).toBe("learners.dormant");
    expect(findingKey("courses.notStarted:abc-1:2026-W48")).toBe("courses.notStarted:abc-1");
    expect(findingKey("plain")).toBe("plain");
  });
});

describe("readSeen", () => {
  it("reads a good value and refuses damaged ones", () => {
    expect(readSeen({ current: snap(0, []) })?.current.active).toBe(9);
    expect(readSeen({ previous: snap(0, []), current: snap(1, []) })?.previous).toBeTruthy();
    expect(readSeen(undefined)).toBeNull();
    expect(readSeen({ current: { at: "soon", findings: [], active: 1, sessions: 1 } })).toBeNull();
    expect(readSeen({ current: { ...snap(0, []), findings: [4] } })).toBeNull();
    // A damaged previous is dropped, not trusted.
    expect(readSeen({ previous: { at: 5 }, current: snap(0, []) })?.previous).toBeUndefined();
  });
});

describe("rollSeen", () => {
  it("starts with a snapshot on a first visit", () => {
    const { seen, changed } = rollSeen(undefined, live(["a:2026-W48"]), at(0));
    expect(changed).toBe(true);
    expect(seen.previous).toBeUndefined();
    expect(seen.current.findings).toEqual(["a"]);
  });

  it("keeps the same comparison when reopened within the window", () => {
    const saved = { previous: snap(-SEEN_ROLL_MS * 3, ["a"]), current: snap(0, ["a", "b"]) };
    const { seen, changed } = rollSeen(saved, live(["c:2026-W48"]), at(SEEN_ROLL_MS - 1));
    expect(changed).toBe(false);
    expect(seen).toEqual(saved);
  });

  it("makes the last snapshot the one to compare with once the window has passed", () => {
    const saved = { previous: snap(-SEEN_ROLL_MS * 3, ["a"]), current: snap(0, ["a", "b"]) };
    const { seen, changed } = rollSeen(saved, live(["c:2026-W48"]), at(SEEN_ROLL_MS));
    expect(changed).toBe(true);
    expect(seen.previous).toEqual(saved.current);
    expect(seen.current.findings).toEqual(["c"]);
  });

  it("keeps each finding once and no more than the backend accepts", () => {
    const many = Array.from({ length: 60 }, (_, i) => `r${i}:2026-W48`);
    expect(rollSeen(undefined, live([...many, ...many]), at(0)).seen.current.findings).toHaveLength(
      40,
    );
  });
});

describe("sinceVisit", () => {
  it("is null on a first visit", () => {
    expect(sinceVisit({ current: snap(0, ["a"]) }, live(["a:2026-W48"]))).toBeNull();
  });

  it("counts what is new, what is resolved and what still needs a look", () => {
    const seen = { previous: snap(0, ["a", "b"]), current: snap(1, []) };
    expect(sinceVisit(seen, live(["b:2026-W48", "c:2026-W48"]))).toEqual({
      at: seen.previous.at,
      added: 1,
      resolved: 1,
      total: 2,
    });
  });

  it("does not call a finding new because the week turned over", () => {
    const seen = { previous: snap(0, ["learners.dormant"]), current: snap(1, []) };
    expect(sinceVisit(seen, live(["learners.dormant:2026-W49"]))).toMatchObject({
      added: 0,
      resolved: 0,
      total: 1,
    });
  });
});
