import { describe, expect, it } from "vitest";

import { PARTS, SECTION_IDS, sectionFromUrl, visibleSections } from "../sections";

const at = (query: string) => sectionFromUrl(new URLSearchParams(query));

describe("sections from the URL", () => {
  it("has six sections", () => {
    expect([...SECTION_IDS]).toEqual([
      "overview",
      "build",
      "conversations",
      "channels",
      "knowledge",
      "settings",
    ]);
  });

  it("opens a section by its id, and Overview by default", () => {
    expect(at("section=settings")).toMatchObject({ section: "settings", tryIt: false });
    expect(at("section=knowledge&part=lists")).toMatchObject({
      section: "knowledge",
      part: "lists",
    });
    expect(at("")).toMatchObject({ section: "overview", tryIt: false });
    expect(at("section=nonsense")).toMatchObject({ section: "overview", tryIt: false });
  });

  it("ignores a part the section does not have", () => {
    expect(at("section=build&part=lists").part).toBeNull();
    expect(at("section=settings&part=lists").part).toBeNull();
  });

  // Every old `?section=` value (the ten sections of the previous home) resolves.
  it.each([
    ["section=overview", "overview", null],
    ["section=knows", "knowledge", "knows"],
    ["section=lists", "knowledge", "lists"],
    ["section=personality", "build", "personality"],
    ["section=safety", "settings", null],
    ["section=how", "settings", null],
    ["section=page", "channels", null],
    ["section=checkup", "build", "checkup"],
    ["section=conversations", "conversations", null],
    ["section=share", "channels", null],
  ])("lands an old section link (%s) on %s", (query, section, part) => {
    const result = at(query);
    expect(result.section).toBe(section);
    expect(result.part).toBe(part);
  });

  // Every old `?tab=` value (the classic tabs, and `?tab=settings&section=…`) resolves.
  it.each([
    ["tab=overview", "overview"],
    ["tab=usage", "overview"],
    ["tab=agent", "overview"],
    ["tab=persona", "build"],
    ["tab=replies", "settings"],
    ["tab=knowledge", "knowledge"],
    ["tab=unanswered", "knowledge"],
    ["tab=conversations", "conversations"],
    ["tab=inbox", "conversations"],
    ["tab=connectors", "channels"],
    ["tab=test", "build"],
    ["tab=settings&section=general", "settings"],
    ["tab=settings&section=people", "settings"],
    ["tab=settings&section=botPage", "channels"],
    ["tab=settings&section=lookAndFeel", "channels"],
    ["tab=settings&section=replies", "settings"],
    ["tab=settings&section=connectors", "channels"],
    ["tab=settings&section=agent", "overview"],
  ])("lands an older link (%s) on %s", (query, section) => {
    expect(at(query).section).toBe(section);
  });

  it("opens Try it for the old Preview tab", () => {
    expect(at("tab=test")).toMatchObject({ section: "build", tryIt: true });
  });

  // The built-in tools left Lists: each deep link follows its tool.
  it.each([
    ["section=lists&tool=pages", "channels"],
    ["section=lists&tool=memory", "settings"],
    ["section=lists&tool=handover", "settings"],
  ])("sends the old tool link (%s) to %s", (query, section) => {
    expect(at(query).section).toBe(section);
  });

  it("keeps a list's own key, so Overview's 'replace' link still opens that list", () => {
    expect(at("section=lists&tool=bookings")).toMatchObject({
      section: "knowledge",
      part: "lists",
      tool: "bookings",
    });
    expect(at("section=knowledge&part=lists&tool=bookings").tool).toBe("bookings");
  });

  it("knows each part of a split section", () => {
    expect(PARTS.build).toEqual(["personality", "checkup"]);
    expect(PARTS.knowledge).toEqual(["knows", "lists"]);
  });

  it("shows a Responder-only member Conversations and nothing else", () => {
    expect(visibleSections(true)).toEqual(["conversations"]);
    expect(visibleSections(false)).toEqual(SECTION_IDS);
  });
});
