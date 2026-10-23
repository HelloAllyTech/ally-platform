import { describe, expect, it } from "vitest";

import { normalizeTurnReceipt } from "../builderReceipt";

const full = {
  read: ["ally-be/src/builder/x.ts"],
  searched: ['Code search "debrief rating" — 4 matches'],
  changed: ["Requirements: added R4"],
  prdVersion: { from: 7, to: 8 },
  failed: ["Read ally-be/src/gone.ts — Not Found"],
  warnings: ["Builder said the PRD changed, but no edit landed this turn."],
  prdUnchangedBecause: "  Waiting on you.  ",
};

describe("normalizeTurnReceipt", () => {
  it("passes a well-formed receipt through, trimming the stated reason", () => {
    expect(normalizeTurnReceipt(full)).toEqual({ ...full, prdUnchangedBecause: "Waiting on you." });
  });

  it("is idempotent, so each layer can call it without knowing whether another did", () => {
    const once = normalizeTurnReceipt(full);
    expect(normalizeTurnReceipt(once)).toEqual(once);
  });

  it("omits a blank or null reason rather than carrying an empty one", () => {
    expect(normalizeTurnReceipt({ ...full, prdUnchangedBecause: null })).not.toHaveProperty(
      "prdUnchangedBecause",
    );
    expect(normalizeTurnReceipt({ ...full, prdUnchangedBecause: "   " })).not.toHaveProperty(
      "prdUnchangedBecause",
    );
  });

  it("reads an unusable prdVersion as 'did not move' rather than inventing a number", () => {
    expect(normalizeTurnReceipt({ ...full, prdVersion: undefined })?.prdVersion).toEqual({
      from: 0,
      to: 0,
    });
    expect(normalizeTurnReceipt({ ...full, prdVersion: { from: 3 } })?.prdVersion).toEqual({
      from: 0,
      to: 0,
    });
    expect(normalizeTurnReceipt({ ...full, prdVersion: { from: "3", to: 4 } })?.prdVersion).toEqual(
      {
        from: 0,
        to: 0,
      },
    );
  });

  it("keeps the readable lists when another is missing, and drops blank lines", () => {
    expect(normalizeTurnReceipt({ read: ["a", "", "  "], failed: "b" })).toMatchObject({
      read: ["a"],
      searched: [],
      changed: [],
      failed: ["b"],
      warnings: [],
    });
  });

  it.each([
    undefined,
    null,
    "receipt",
    3,
    [],
    {},
    { prdVersion: { from: 1, to: 2 } },
    { read: "a" },
  ])("is not a receipt: %j", value => {
    expect(normalizeTurnReceipt(value)).toBeNull();
  });
});
