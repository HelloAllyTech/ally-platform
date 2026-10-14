import { describe, expect, it } from "vitest";

import { userTurnText } from "../userTurnText";

/** The shapes ally-be's `renderUserContent` writes (Builder, Course Copilot, character interview). */
describe("userTurnText", () => {
  it("strips the answered-question prefix and the selected-ids suffix", () => {
    expect(userTurnText("[answers question q1] Warm and guarded [selected ids: guarded]")).toBe(
      "Warm and guarded",
    );
  });

  it("strips a multi-part suffix", () => {
    expect(
      userTurnText(
        '[answers question q2] Teachers, Peer supporters [selected ids: t | custom: "Peer supporters"]',
      ),
    ).toBe("Teachers, Peer supporters");
  });

  it("strips a none-of-these suffix", () => {
    expect(userTurnText("[answers question q3] None of these [none of these]")).toBe(
      "None of these",
    );
  });

  // A custom value is free text; a bracket inside its quotes must not end the match early and
  // leave the suffix half-stripped.
  it("strips a suffix whose custom value contains a bracket", () => {
    expect(userTurnText('[answers question q4] [draft] v2 [custom: "[draft] v2"]')).toBe(
      "[draft] v2",
    );
  });

  it("leaves an admin's own words alone, brackets included", () => {
    expect(userTurnText("Make the [intro] shorter")).toBe("Make the [intro] shorter");
    expect(userTurnText("Free-typed answer")).toBe("Free-typed answer");
  });

  it("treats missing or non-string content as empty", () => {
    expect(userTurnText(null)).toBe("");
    expect(userTurnText(undefined)).toBe("");
    expect(userTurnText(42 as never)).toBe("");
  });
});
