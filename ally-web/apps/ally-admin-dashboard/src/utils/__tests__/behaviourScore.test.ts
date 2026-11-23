import { describe, it, expect } from "vitest";

import {
  defaultBehaviourScore,
  effectiveBehaviourScore,
  sameBehaviourScore,
  validateBehaviourScore,
} from "../behaviourScore";

describe("behaviourScore", () => {
  it("defaults to +10 for should-do and -10 for should-not-do", () => {
    expect(defaultBehaviourScore("SHOULD_DO")).toBe(10);
    expect(defaultBehaviourScore("SHOULD_NOT_DO")).toBe(-10);
  });

  it("uses the authored score, including 0, else the default", () => {
    expect(effectiveBehaviourScore("SHOULD_DO", 75)).toBe(75);
    expect(effectiveBehaviourScore("SHOULD_NOT_DO", 0)).toBe(0);
    expect(effectiveBehaviourScore("SHOULD_DO", null)).toBe(10);
    expect(effectiveBehaviourScore("SHOULD_NOT_DO", undefined)).toBe(-10);
  });

  describe("validateBehaviourScore", () => {
    it.each([
      ["75", "SHOULD_DO", 75],
      ["100", "SHOULD_DO", 100],
      ["0", "SHOULD_DO", 0],
      ["-75", "SHOULD_NOT_DO", -75],
      ["-100", "SHOULD_NOT_DO", -100],
      ["-0", "SHOULD_NOT_DO", 0],
    ])("accepts %s for %s", (raw, category, value) => {
      const r = validateBehaviourScore(raw, category);
      expect(r.ok && r.value).toBe(value);
    });

    it("rejects 101 and -101 as out of range", () => {
      expect(validateBehaviourScore("101", "SHOULD_DO")).toEqual({
        ok: false,
        error: "Between -100 and 100",
      });
      expect(validateBehaviourScore("-101", "SHOULD_NOT_DO")).toEqual({
        ok: false,
        error: "Between -100 and 100",
      });
    });

    it("rejects a non-integer rather than rounding it", () => {
      expect(validateBehaviourScore("50.5", "SHOULD_DO")).toEqual({
        ok: false,
        error: "Whole numbers only",
      });
    });

    it("rejects empty and non-numeric input", () => {
      expect(validateBehaviourScore("", "SHOULD_DO").ok).toBe(false);
      expect(validateBehaviourScore("abc", "SHOULD_DO").ok).toBe(false);
      expect(validateBehaviourScore("1e2", "SHOULD_DO").ok).toBe(false);
    });

    it("keeps the sign with the category", () => {
      expect(validateBehaviourScore("-10", "SHOULD_DO").ok).toBe(false);
      expect(validateBehaviourScore("10", "SHOULD_NOT_DO").ok).toBe(false);
    });
  });

  it("treats unset scores as the same and distinguishes authored numbers", () => {
    expect(sameBehaviourScore(undefined, null)).toBe(true);
    expect(sameBehaviourScore(50, 50)).toBe(true);
    expect(sameBehaviourScore(50, undefined)).toBe(false);
    expect(sameBehaviourScore(0, undefined)).toBe(false);
  });
});
