import { describe, expect, it } from "vitest";

import { ImageSlotProfile, ImageStyle } from "@types";

import { compactContext, pickDefaultStyleId, swatchGradient, toContextText } from "../utils";

const style = (id: string): ImageStyle => ({
  id,
  name: id,
  description: "",
  kind: "photo",
  thumbnailUrl: "",
  swatch: ["#000000", "#ffffff"],
  recommendedSlots: [],
});

const styles = [style("documentary_photo"), style("watercolour"), style("line_art")];
const slotProfile = { defaultStyleId: "line_art" } as ImageSlotProfile;

describe("pickDefaultStyleId", () => {
  it("prefers an explicit style, then the course's, then the slot's, then the last used", () => {
    const base = { styles, slotProfile, lastStyleId: "watercolour" };
    expect(
      pickDefaultStyleId({ ...base, initialStyleId: "watercolour", courseStyleId: "line_art" }),
    ).toBe("watercolour");
    expect(pickDefaultStyleId({ ...base, courseStyleId: "documentary_photo" })).toBe(
      "documentary_photo",
    );
    expect(pickDefaultStyleId(base)).toBe("line_art");
    expect(pickDefaultStyleId({ styles, lastStyleId: "watercolour" })).toBe("watercolour");
  });

  it("ignores ids the gallery doesn't list, and falls back to the first style", () => {
    expect(pickDefaultStyleId({ styles, courseStyleId: "retired_style" })).toBe(
      "documentary_photo",
    );
    expect(pickDefaultStyleId({ styles: [] })).toBeNull();
  });
});

describe("toContextText", () => {
  it("turns rich text into one line, keeping block boundaries apart", () => {
    expect(toContextText("<p>Learn to <b>listen</b>.</p><p>Then reflect.</p>")).toBe(
      "Learn to listen. Then reflect.",
    );
    expect(toContextText(null)).toBe("");
  });

  it("cuts long text at a word boundary", () => {
    const text = toContextText(`<p>${"word ".repeat(400)}</p>`, 50);
    expect(text.length).toBeLessThanOrEqual(51);
    expect(text.endsWith("word…")).toBe(true);
  });
});

describe("compactContext", () => {
  it("drops blank fields and an empty persona", () => {
    expect(
      compactContext({
        title: " Grief ",
        text: "",
        persona: { name: " ", age: 34, profession: "nurse" },
      }),
    ).toEqual({ title: "Grief", persona: { age: "34", profession: "nurse" } });
    expect(compactContext({ persona: { name: "" } })).toEqual({});
  });
});

describe("swatchGradient", () => {
  it("makes a gradient from the two swatch colours", () => {
    expect(swatchGradient(["#111111", "#eeeeee"])).toBe(
      "linear-gradient(135deg, #111111, #eeeeee)",
    );
  });
});
