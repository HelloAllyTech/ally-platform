import { describe, expect, it } from "vitest";

import { errorMessage } from "../drafts/draftUtils";

describe("errorMessage", () => {
  it("returns the server's sentence for a 4xx refusal", () => {
    expect(errorMessage({ status: 409, data: { message: "This idea is finished." } })).toBe(
      "This idea is finished.",
    );
  });

  it("never shows a 5xx message or a blank one", () => {
    expect(errorMessage({ status: 500, data: { message: "Internal" } })).toBeUndefined();
    expect(errorMessage({ status: 409, data: { message: "  " } })).toBeUndefined();
    expect(errorMessage({ status: 422, data: { message: ["a", "b"] } })).toBeUndefined();
    expect(errorMessage(new Error("network"))).toBeUndefined();
  });
});
