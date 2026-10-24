import { describe, expect, it } from "vitest";

import {
  canStartCanary,
  CANARY_MAX_PERCENT,
  DEFAULT_CANARY_PERCENT,
  parseCanaryPercent,
} from "../canaryShare";

describe("parseCanaryPercent", () => {
  it("reads a whole number from 1 to the cap", () => {
    expect(parseCanaryPercent("1")).toBe(1);
    expect(parseCanaryPercent("20")).toBe(20);
    expect(parseCanaryPercent(String(CANARY_MAX_PERCENT))).toBe(CANARY_MAX_PERCENT);
    expect(parseCanaryPercent("  15 ")).toBe(15);
  });

  it("refuses anything above the cap or below one", () => {
    expect(parseCanaryPercent(String(CANARY_MAX_PERCENT + 1))).toBeNull();
    expect(parseCanaryPercent("100")).toBeNull();
    expect(parseCanaryPercent("0")).toBeNull();
    expect(parseCanaryPercent("-5")).toBeNull();
  });

  it("refuses text that is not a plain whole number, rather than rounding it to something unmeant", () => {
    for (const text of ["", " ", "abc", "12.5", "2e1", "20%", "1 0", "٢٠"]) {
      expect(parseCanaryPercent(text)).toBeNull();
    }
  });

  it("starts at the plan's 20, which is inside the cap", () => {
    expect(DEFAULT_CANARY_PERCENT).toBe(20);
    expect(parseCanaryPercent(String(DEFAULT_CANARY_PERCENT))).toBe(20);
  });
});

describe("canStartCanary", () => {
  it("allows the stages before canary, and the canary itself to change its share", () => {
    for (const status of ["draft", "candidate", "shadow", "canary"]) {
      expect(canStartCanary(status)).toBe(true);
    }
  });

  it("refuses the live release, a retired one and one still being evaluated, as ally-be does", () => {
    for (const status of ["ga", "retired", "evaluating"]) {
      expect(canStartCanary(status)).toBe(false);
    }
  });
});
