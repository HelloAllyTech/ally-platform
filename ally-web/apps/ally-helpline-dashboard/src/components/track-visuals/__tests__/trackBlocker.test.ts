import { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { TrackBlocker } from "@types";

import { formatTrackBlocker } from "../trackBlocker";

// Echoes key + interpolation so assertions see the exact values passed in.
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (key.startsWith("tracks2.roleplay.duration")) {
    return `${opts?.minutes ?? 0}m${opts?.seconds ?? 0}s`;
  }
  const { title, ...rest } = opts ?? {};
  const extra = Object.entries(rest)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${key}|${title}${extra ? `|${extra}` : ""}`;
}) as unknown as TFunction;

const blocker = (over: Partial<TrackBlocker>): TrackBlocker => ({
  itemId: "i1",
  title: "Prev",
  type: "ROLEPLAY",
  reasons: [{ code: "NOT_FINISHED" }],
  action: "OPEN",
  ...over,
});

const one = (code: string, over: Partial<TrackBlocker> = {}, extra = {}) =>
  formatTrackBlocker(blocker({ reasons: [{ code: code as never, ...extra }], ...over }), t);

describe("formatTrackBlocker", () => {
  it("NOT_FINISHED", () => {
    expect(one("NOT_FINISHED")).toEqual(["tracks2.blocker.notFinished|Prev"]);
  });
  it("BELOW_SCORE uses points for roleplay and case", () => {
    expect(one("BELOW_SCORE", {}, { actual: 40, required: 70 })).toEqual([
      "tracks2.blocker.belowScore|Prev|actual=40,required=70",
    ]);
    expect(one("BELOW_SCORE", { type: "CASE" }, { actual: 1, required: 2 })[0]).toContain(
      "actual=1,required=2",
    );
  });
  it("BELOW_SCORE uses percent for quiz-like types", () => {
    for (const type of ["QUIZ", "ANNOTATED_ARTIFACT", "BRANCHING_SCENARIO"]) {
      expect(one("BELOW_SCORE", { type }, { actual: 40, required: 70 })).toEqual([
        "tracks2.blocker.belowScore|Prev|actual=40%,required=70%",
      ]);
    }
  });
  it("TOO_SHORT formats seconds as durations", () => {
    expect(one("TOO_SHORT", {}, { actual: 45, required: 90 })).toEqual([
      "tracks2.blocker.tooShort|Prev|actual=0m45s,required=1m30s",
    ]);
  });
  it("NOT_SCORED", () => {
    expect(one("NOT_SCORED")).toEqual(["tracks2.blocker.notScored|Prev"]);
  });
  it("ASSESSMENT_FAILED", () => {
    expect(one("ASSESSMENT_FAILED")).toEqual(["tracks2.blocker.assessmentFailed|Prev"]);
  });
  it("GRADING_PENDING", () => {
    expect(one("GRADING_PENDING")).toEqual(["tracks2.blocker.gradingPending|Prev"]);
  });
  it("OUT_OF_ATTEMPTS without a retry date", () => {
    expect(one("OUT_OF_ATTEMPTS")).toEqual(["tracks2.blocker.outOfAttempts|Prev"]);
  });
  it("OUT_OF_ATTEMPTS with a retry date", () => {
    const [line] = one("OUT_OF_ATTEMPTS", { retryAt: "2026-12-05T10:00:00.000Z" });
    expect(line).toMatch(/^tracks2\.blocker\.outOfAttemptsUntil\|Prev\|date=.*2026/);
  });
  it("WATCH_MORE", () => {
    expect(one("WATCH_MORE", { type: "VIDEO" }, { actual: 30, required: 80 })).toEqual([
      "tracks2.blocker.watchMore|Prev|actual=30,required=80",
    ]);
  });
  it("KEEP_READING", () => {
    expect(one("KEEP_READING")).toEqual(["tracks2.blocker.keepReading|Prev"]);
  });
  it("two reasons give two lines", () => {
    const lines = formatTrackBlocker(
      blocker({
        reasons: [
          { code: "BELOW_SCORE", actual: 40, required: 70 },
          { code: "TOO_SHORT", actual: 30, required: 60 },
        ],
      }),
      t,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("belowScore");
    expect(lines[1]).toContain("tooShort");
  });
  it("unknown code falls back to NOT_FINISHED", () => {
    expect(one("SOMETHING_NEW")).toEqual(["tracks2.blocker.notFinished|Prev"]);
  });
});
