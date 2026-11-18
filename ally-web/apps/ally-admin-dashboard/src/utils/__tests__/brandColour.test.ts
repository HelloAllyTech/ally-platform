import { describe, expect, it } from "vitest";

import {
  ALLY_BONE,
  ALLY_BRAND_PRIMARY,
  ALLY_INK,
  brandContrastVerdict,
  buildPreviewRamp,
  contrastRatio,
  isHexColour,
  normaliseHex,
  pickOnPrimary,
} from "../brandColour";

// These pin the client copy to the backend's numbers (ally-be
// brand-colour.util.spec): if either side's factors move, one of these fails.
describe("brandColour", () => {
  it("accepts only #RRGGBB and normalises to uppercase", () => {
    expect(isHexColour("#264d8e")).toBe(true);
    expect(isHexColour("264d8e")).toBe(false);
    expect(isHexColour("#fff")).toBe(false);
    expect(isHexColour(null)).toBe(false);
    expect(normaliseHex("#264d8e")).toBe("#264D8E");
  });

  it("computes WCAG contrast like the backend", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#264D8E", "#264D8E")).toBe(1);
  });

  it("derives the same ramp as the backend for Ally Blue", () => {
    const ramp = buildPreviewRamp(ALLY_BRAND_PRIMARY);
    expect(ramp[500]).toBe("#264D8E");
    expect(ramp[50]).toBe("#EEF1F6");
    expect(ramp[700]).toBe("#183159");
    expect(ramp[900]).toBe("#0A1425");
  });

  it("picks bone on dark brands and ink on light ones", () => {
    expect(pickOnPrimary("#264D8E")).toBe(ALLY_BONE);
    expect(pickOnPrimary("#F5D000")).toBe(ALLY_INK);
  });

  it("mirrors the backend thresholds: fail under 3:1, weak under 4.5:1", () => {
    expect(brandContrastVerdict("#F0EEE7").verdict).toBe("fail");
    expect(brandContrastVerdict("#CC5500").verdict).toBe("weak");
    expect(brandContrastVerdict("#264D8E").verdict).toBe("pass");
    expect(brandContrastVerdict("#264D8E").ratio).toBeGreaterThan(4.5);
  });
});
