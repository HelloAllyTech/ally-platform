import { describe, expect, it } from "vitest";

import { formatRate, formatTokens } from "../scorecard";

describe("formatters", () => {
  it("shows a missing rate as an em-dash rather than as zero", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.336)).toBe("34%");
  });

  it("abbreviates token counts, since no decision turns on the digits", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(84_000)).toBe("84k");
    expect(formatTokens(1_238_004)).toBe("1.2M");
  });
});
