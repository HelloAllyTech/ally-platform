import { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { TrackDetailItem, TrackItemCompletionLogic, TrackItemType } from "@types";

import { getTrackItemMeta } from "../trackItemMeta";

// Echoes the key plus its interpolation, so assertions can tell
// "roleplay" from "roleplay · min score N" without loading real translations.
const t = ((key: string, opts?: { score?: number; duration?: string }) => {
  if (opts?.score !== undefined) return `${key}:${opts.score}`;
  if (opts?.duration !== undefined) return `${key}:${opts.duration}`;
  return key;
}) as unknown as TFunction;

const roleplayItem = (criteria: TrackDetailItem["completionCriteria"]): TrackDetailItem =>
  ({
    type: TrackItemType.ROLEPLAY,
    completionCriteria: criteria || {},
  }) as unknown as TrackDetailItem;

describe("getTrackItemMeta — roleplay", () => {
  describe("minimum score", () => {
    it("shows a real threshold", () => {
      expect(getTrackItemMeta(roleplayItem({ minScore: 70 }), t)).toBe(
        "tracks2.meta.roleplay · tracks2.meta.minScore:70",
      );
    });

    // 0 is the builder's unconfigured default and gates nothing, so surfacing it
    // would advertise a hurdle the learner does not actually have to clear.
    it("omits a minimum of 0", () => {
      expect(getTrackItemMeta(roleplayItem({ minScore: 0 }), t)).toBe("tracks2.meta.roleplay");
    });

    it("omits an unset minimum", () => {
      expect(getTrackItemMeta(roleplayItem({}), t)).toBe("tracks2.meta.roleplay");
      expect(getTrackItemMeta(roleplayItem(null), t)).toBe("tracks2.meta.roleplay");
    });
  });

  describe("completion logic", () => {
    it("shows participation only", () => {
      expect(
        getTrackItemMeta(
          roleplayItem({ completionLogic: TrackItemCompletionLogic.PARTICIPATION }),
          t,
        ),
      ).toBe("tracks2.meta.roleplay · tracks2.meta.participation");
    });

    it("shows only duration when logic is DURATION", () => {
      expect(
        getTrackItemMeta(
          roleplayItem({
            completionLogic: TrackItemCompletionLogic.DURATION,
            minScore: 70,
            minDurationSeconds: 125,
          }),
          t,
        ),
      ).toBe("tracks2.meta.roleplay · tracks2.meta.minDuration:2m 5s");
    });

    it("shows only score when logic is SCORE", () => {
      expect(
        getTrackItemMeta(
          roleplayItem({
            completionLogic: TrackItemCompletionLogic.SCORE,
            minScore: 70,
            minDurationSeconds: 125,
          }),
          t,
        ),
      ).toBe("tracks2.meta.roleplay · tracks2.meta.minScore:70");
    });

    it("shows both when logic is SCORE_AND_DURATION", () => {
      expect(
        getTrackItemMeta(
          roleplayItem({
            completionLogic: TrackItemCompletionLogic.SCORE_AND_DURATION,
            minScore: 70,
            minDurationSeconds: 125,
          }),
          t,
        ),
      ).toBe("tracks2.meta.roleplay · tracks2.meta.minScore:70 · tracks2.meta.minDuration:2m 5s");
    });

    it("formats duration correctly (minutes only)", () => {
      expect(
        getTrackItemMeta(
          roleplayItem({
            completionLogic: TrackItemCompletionLogic.DURATION,
            minDurationSeconds: 120,
          }),
          t,
        ),
      ).toBe("tracks2.meta.roleplay · tracks2.meta.minDuration:2m");
    });

    it("formats duration correctly (seconds only)", () => {
      expect(
        getTrackItemMeta(
          roleplayItem({
            completionLogic: TrackItemCompletionLogic.DURATION,
            minDurationSeconds: 45,
          }),
          t,
        ),
      ).toBe("tracks2.meta.roleplay · tracks2.meta.minDuration:45s");
    });
  });
});
