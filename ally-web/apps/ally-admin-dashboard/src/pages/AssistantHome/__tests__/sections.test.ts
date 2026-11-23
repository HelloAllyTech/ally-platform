import { describe, expect, it } from "vitest";

import { sectionFromUrl } from "../sections";

const at = (query: string) => sectionFromUrl(new URLSearchParams(query));

describe("sections from the URL", () => {
  it("opens a section by its id, and Overview by default", () => {
    expect(at("section=safety")).toEqual({ section: "safety", tryIt: false });
    expect(at("")).toEqual({ section: "overview", tryIt: false });
    expect(at("section=nonsense")).toEqual({ section: "overview", tryIt: false });
  });

  it.each([
    ["tab=persona", "personality"],
    ["tab=knowledge", "knows"],
    ["tab=unanswered", "knows"],
    ["tab=conversations", "conversations"],
    ["tab=usage", "overview"],
    ["tab=connectors", "share"],
    ["tab=settings&section=people", "share"],
    ["tab=settings&section=botPage", "page"],
    ["tab=settings&section=lookAndFeel", "page"],
    ["tab=settings&section=replies", "personality"],
    ["tab=settings&section=general", "safety"],
    ["tab=settings&section=agent", "overview"],
  ])("lands an older link (%s) on %s", (query, section) => {
    expect(at(query).section).toBe(section);
  });

  it("opens Try it for the old Preview tab", () => {
    expect(at("tab=test")).toEqual({ section: "overview", tryIt: true });
  });
});
