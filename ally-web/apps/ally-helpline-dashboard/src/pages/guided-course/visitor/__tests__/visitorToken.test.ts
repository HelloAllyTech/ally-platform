import { afterEach, describe, expect, it, vi } from "vitest";

import { dropVisitorToken, readVisitorToken, storeVisitorToken } from "../visitorToken";

describe("visitorToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    dropVisitorToken();
    localStorage.clear();
  });

  it("keeps the token per browser and drops it", () => {
    storeVisitorToken("tok");
    expect(localStorage.getItem("allyGuideVisitor")).toBe("tok");
    expect(readVisitorToken()).toBe("tok");
    dropVisitorToken();
    expect(readVisitorToken()).toBeNull();
  });

  it("falls back to memory when storage throws (private mode, blocked site data)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeVisitorToken("tok")).not.toThrow();
    expect(readVisitorToken()).toBe("tok");
    expect(() => dropVisitorToken()).not.toThrow();
    expect(readVisitorToken()).toBeNull();
  });
});
