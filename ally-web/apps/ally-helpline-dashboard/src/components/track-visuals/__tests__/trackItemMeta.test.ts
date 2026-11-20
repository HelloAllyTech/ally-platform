import { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { TrackDetailItem, TrackItemType } from "@types";

import { getTrackItemMeta } from "../trackItemMeta";

// Echoes the key plus its score interpolation, so assertions can tell
// "roleplay" from "roleplay · min score N" without loading real translations.
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (!opts) return key;
  if (opts.score !== undefined) return `${key}:${opts.score}`;
  if (opts.duration !== undefined) return `${key}:${opts.duration}`;
  if (opts.minutes !== undefined && opts.seconds !== undefined)
    return `${opts.minutes}m${opts.seconds}s`;
  if (opts.minutes !== undefined) return `${opts.minutes}m`;
  if (opts.seconds !== undefined) return `${opts.seconds}s`;
  return key;
}) as unknown as TFunction;

const roleplayItem = (minScore?: number | null): TrackDetailItem =>
  ({
    type: TrackItemType.ROLEPLAY,
    completionCriteria: minScore === undefined ? {} : { minScore },
  }) as unknown as TrackDetailItem;

describe("getTrackItemMeta — roleplay minimum score", () => {
  it("shows a real threshold", () => {
    expect(getTrackItemMeta(roleplayItem(70), t)).toBe(
      "tracks2.meta.roleplay · tracks2.meta.minScore:70",
    );
  });

  // 0 is the builder's unconfigured default and gates nothing, so surfacing it
  // would advertise a hurdle the learner does not actually have to clear.
  it("omits a minimum of 0", () => {
    expect(getTrackItemMeta(roleplayItem(0), t)).toBe("tracks2.meta.roleplay");
  });

  it("omits an unset minimum", () => {
    expect(getTrackItemMeta(roleplayItem(undefined), t)).toBe("tracks2.meta.roleplay");
    expect(getTrackItemMeta(roleplayItem(null), t)).toBe("tracks2.meta.roleplay");
  });
});

describe("getTrackItemMeta — roleplay completion logic", () => {
  const withGate = (roleplayGate: TrackDetailItem["roleplayGate"]): TrackDetailItem =>
    ({
      type: TrackItemType.ROLEPLAY,
      completionCriteria: {},
      roleplayGate,
    }) as unknown as TrackDetailItem;

  it("SCORE shows the score only", () => {
    expect(
      getTrackItemMeta(
        withGate({ completionLogic: "SCORE", minScore: 60, minDurationSeconds: null }),
        t,
      ),
    ).toBe("tracks2.meta.roleplay · tracks2.meta.minScore:60");
  });

  it("DURATION shows the duration only", () => {
    expect(
      getTrackItemMeta(
        withGate({ completionLogic: "DURATION", minScore: null, minDurationSeconds: 90 }),
        t,
      ),
    ).toBe("tracks2.meta.roleplay · tracks2.meta.minDuration:1m30s");
  });

  it("SCORE_AND_DURATION shows both, with the platform default duration", () => {
    expect(
      getTrackItemMeta(
        withGate({ completionLogic: "SCORE_AND_DURATION", minScore: 60, minDurationSeconds: 180 }),
        t,
      ),
    ).toBe("tracks2.meta.roleplay · tracks2.meta.minScore:60 · tracks2.meta.minDuration:3m");
  });

  it("PARTICIPATION says it completes on start", () => {
    expect(
      getTrackItemMeta(
        withGate({ completionLogic: "PARTICIPATION", minScore: null, minDurationSeconds: null }),
        t,
      ),
    ).toBe("tracks2.meta.roleplay · tracks2.meta.participation");
  });
});
