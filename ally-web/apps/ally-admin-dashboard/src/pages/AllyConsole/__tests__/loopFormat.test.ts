import { describe, expect, it } from "vitest";

import { humanise, summariseDetail } from "../loopFormat";

describe("humanise", () => {
  it("turns an id into a sentence-case label", () => {
    expect(humanise("status_changed")).toBe("Status changed");
    expect(humanise("kappa")).toBe("Kappa");
  });

  it("returns what it was given when there is nothing to say", () => {
    expect(humanise("")).toBe("");
    expect(humanise("___")).toBe("___");
  });
});

describe("summariseDetail", () => {
  it("keeps simple values, splits camelCase keys and drops nested ones", () => {
    expect(
      summariseDetail({
        tenantCount: 2,
        notes: "fine",
        passed: false,
        nested: { a: 1 },
        list: [1],
      }),
    ).toBe("tenant count: 2 · notes: fine · passed: false");
  });

  it("leaves out empty strings and keeps at most four", () => {
    expect(summariseDetail({ a: "", b: 1, c: 2, d: 3, e: 4, f: 5 })).toBe(
      "b: 1 · c: 2 · d: 3 · e: 4",
    );
  });

  it("is empty for nothing", () => {
    expect(summariseDetail(null)).toBe("");
    expect(summariseDetail(undefined)).toBe("");
    expect(summariseDetail({})).toBe("");
  });
});
