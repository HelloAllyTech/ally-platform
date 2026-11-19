import { describe, expect, it } from "vitest";

import { periodFor } from "../Costs/period";
import {
  formatCost,
  formatPerMessage,
  formatPerMillion,
  formatUsd,
  microsToUsd,
  parseUsdField,
} from "../money";

describe("Billing money helpers", () => {
  it("turns micros into dollars, and keeps no price as no price", () => {
    expect(microsToUsd(400_000)).toBe(0.4);
    expect(microsToUsd("1600000")).toBe(1.6);
    expect(microsToUsd(0)).toBe(0);
    expect(microsToUsd(null)).toBeNull();
    expect(microsToUsd(undefined)).toBeNull();
  });

  it("shows per-million prices to 3 decimals and a WhatsApp message to 4", () => {
    expect(formatPerMillion(400_000)).toBe("$0.400");
    expect(formatPerMillion(100_000)).toBe("$0.100");
    expect(formatPerMillion(15_000_000)).toBe("$15.000");
    expect(formatPerMillion(null)).toBe("—");
    expect(formatPerMessage(11_800)).toBe("$0.0118");
  });

  it("groups thousands and keeps the sign", () => {
    expect(formatUsd(1234567.891, 2)).toBe("$1,234,567.89");
    expect(formatUsd(-2.5, 2)).toBe("-$2.50");
  });

  it("shows small cost totals with enough decimals not to read as zero", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(12.3)).toBe("$12.30");
    expect(formatCost(null)).toBe("—");
  });

  it("reads a blank dollar field as no price", () => {
    expect(parseUsdField("  ")).toBeNull();
    expect(parseUsdField("0.4")).toBe(0.4);
    expect(Number.isNaN(parseUsdField("abc"))).toBe(true);
  });

  it("turns a period preset into the dates ally-be reads (UTC, `to` exclusive)", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(periodFor("month", now)).toEqual({ from: "2026-11-01" });
    expect(periodFor("last7", now)).toEqual({ from: "2026-11-13" });
    expect(periodFor("lastMonth", now)).toEqual({ from: "2026-10-01", to: "2026-11-01" });
  });
});
