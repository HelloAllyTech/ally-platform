import { describe, expect, it } from "vitest";

import { ANALYTICS_TAB_GROUPS, groupForTab, tabsInGroup } from "../analyticsTabGroups";
import { readAnalyticsUrlState, writeAnalyticsUrlState } from "../analyticsUrlState";

const read = (q: string) => readAnalyticsUrlState(new URLSearchParams(q));

describe("analyticsUrlState", () => {
  it("defaults to 90 days, all languages, no org, ids hidden", () => {
    expect(read("")).toEqual({
      range: "90d",
      from: undefined,
      to: undefined,
      language: "",
      org: "",
      showIds: false,
    });
  });
  it("reads presets, language, org and the ids toggle", () => {
    expect(read("range=12m&lang=hi-IN&org=abc&ids=1")).toMatchObject({
      range: "12m",
      language: "hi-IN",
      org: "abc",
      showIds: true,
    });
  });
  it("treats a valid from/to pair as a custom range", () => {
    expect(read("from=2026-01-01&to=2026-02-01")).toMatchObject({
      range: "custom",
      from: "2026-01-01",
      to: "2026-02-01",
    });
  });
  it("drops a reversed or malformed pair", () => {
    expect(read("range=custom&from=2026-03-01&to=2026-02-01").from).toBeUndefined();
    expect(read("from=nope&to=2026-02-01").range).toBe("90d");
  });
  it("ignores an unknown range", () => {
    expect(read("range=forever").range).toBe("90d");
  });
  it("writes only non-default values and clears from/to on a preset", () => {
    const base = new URLSearchParams("tab=latency&range=custom&from=2026-01-01&to=2026-02-01");
    expect(writeAnalyticsUrlState(base, { range: "30d" }).toString()).toBe("tab=latency&range=30d");
    expect(writeAnalyticsUrlState(base, { range: "90d" }).toString()).toBe("tab=latency");
    expect(writeAnalyticsUrlState(new URLSearchParams(), { language: "ta" }).toString()).toBe(
      "lang=ta",
    );
    expect(
      writeAnalyticsUrlState(new URLSearchParams("lang=ta"), { language: "" }).toString(),
    ).toBe("");
  });
});

describe("analyticsTabGroups", () => {
  it("places every known tab in exactly one group", () => {
    const ids = ANALYTICS_TAB_GROUPS.flatMap(g => g.tabIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groupForTab("latency").id).toBe("quality");
    expect(groupForTab("brand-new-tab").id).toBe("planning");
  });
  it("keeps only visible tabs, in the group's order", () => {
    const tabs = [{ id: "scribe" }, { id: "highlights" }];
    expect(tabsInGroup(ANALYTICS_TAB_GROUPS[0], tabs).map(t => t.id)).toEqual([
      "highlights",
      "scribe",
    ]);
  });
});
