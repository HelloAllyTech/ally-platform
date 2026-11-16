import { describe, expect, it } from "vitest";

import { afterLoginPath, loginPathWithNext, safeNext } from "../loginRedirect";

describe("back where they were after logging in (A1)", () => {
  it("carries a deep link through login", () => {
    expect(loginPathWithNext("/assistants/b1", "?section=lists&tool=memory")).toBe(
      `/login?next=${encodeURIComponent("/assistants/b1?section=lists&tool=memory")}`,
    );
    expect(afterLoginPath(`?next=${encodeURIComponent("/assistants/b1?section=lists")}`)).toBe(
      "/assistants/b1?section=lists",
    );
  });

  it("adds no next for the root or login itself", () => {
    expect(loginPathWithNext("/")).toBe("/login");
    expect(loginPathWithNext("/login", "?next=/x")).toBe("/login");
  });

  it("refuses a next that leaves the app", () => {
    for (const bad of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "/login",
      "/login?next=/x",
      "/x\u0000y",
      "",
      null,
    ]) {
      expect(safeNext(bad)).toBeNull();
    }
    expect(afterLoginPath("?next=//evil.example")).toBe("/");
    expect(afterLoginPath("")).toBe("/");
  });
});
