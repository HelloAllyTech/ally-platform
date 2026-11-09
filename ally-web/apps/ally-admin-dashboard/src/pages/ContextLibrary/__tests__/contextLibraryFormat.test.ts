import { describe, expect, it } from "vitest";

import { en } from "@constants";
import type { ContextCollectionYield } from "@types";

import {
  bandLabel,
  bulkSummary,
  chunkStatusLabels,
  facetLine,
  findingMessage,
  findingsFromError,
  humanise,
  keptCount,
  matchesFacets,
  nounsFor,
  ordinal,
  originFilterLabel,
  originLabel,
  sourceCountLine,
  splitDocuments,
  textHints,
  yieldSentence,
} from "../contextLibraryFormat";

const yieldOf = (over: Partial<ContextCollectionYield> = {}): ContextCollectionYield => ({
  candidates: 0,
  published: 0,
  publishedLowConfidence: 0,
  merged: 0,
  rejected: {},
  overCap: 0,
  ...over,
});

describe("copy glossary", () => {
  it("names each origin the way the plan's glossary does", () => {
    expect(originLabel("distilled")).toBe("Extracted");
    expect(originLabel("authored")).toBe("Written");
    expect(originLabel("imported")).toBe("Imported");
    expect(originLabel("agent")).toBe("Agent");
    expect(originLabel("synced")).toBe("Synced from Studio");
    expect(originFilterLabel("synced")).toBe("Synced");
  });

  it("labels search bands with words", () => {
    expect(bandLabel("strong")).toBe("Strong match");
    expect(bandLabel("good")).toBe("Good match");
  });

  it("says low confidence and merged in plain words, with the collection's noun", () => {
    expect(
      chunkStatusLabels({ status: "active", confidence: "low", pinned: false }, "principle"),
    ).toEqual(["Low confidence"]);
    expect(
      chunkStatusLabels({ status: "superseded", confidence: "standard", pinned: true }, "insight"),
    ).toEqual(["Merged into another insight", "Pinned"]);
  });

  it("falls back to item/items when no single collection is selected", () => {
    expect(nounsFor(undefined)).toEqual({ noun: "item", nounPlural: "items" });
    expect(nounsFor({ noun: "entry", nounPlural: "entries" })).toEqual({
      noun: "entry",
      nounPlural: "entries",
    });
  });

  /**
   * The UI says each collection's noun, never "chunk" (Settings excepted), and says "extract",
   * "part" and "document" rather than distil, segment and source. Every string and every
   * string-producing function in the copy is checked.
   */
  it("never uses the internal words outside Settings", () => {
    const texts: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") texts.push(value);
      else if (typeof value === "function") {
        const out = (value as (...args: unknown[]) => unknown)(
          2,
          "principle",
          "principles",
          3,
          4,
          "x",
        );
        if (typeof out === "string") texts.push(out);
      } else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    const { settings, ...rest } = en.contextLibrary;
    walk(rest);
    expect(texts.length).toBeGreaterThan(100);
    for (const text of texts) {
      expect(text).not.toMatch(/\bchunks?\b/i);
      expect(text).not.toMatch(/distil/i);
      expect(text).not.toMatch(/\bsegments?\b/i);
      expect(text).not.toMatch(/\bsources?\b/i);
    }
    // Settings is the one place "chunk" may appear.
    expect(settings.intro).toMatch(/chunks/);
  });
});

describe("yieldSentence", () => {
  it("writes the report as one sentence, rejections grouped by reason", () => {
    const sentence = yieldSentence(
      yieldOf({
        published: 21,
        publishedLowConfidence: 2,
        merged: 6,
        rejected: { platitude: 7, verbatim: 2 },
      }),
      { parts: 31, noun: "principle", nounPlural: "principles" },
    );
    expect(sentence).toBe(
      "Read 31 parts · kept 23 principles · strengthened 6 existing ones · left out 7 as too generic · left out 2 as too close to the original wording · 2 low confidence",
    );
  });

  it("merges reasons that read the same and names unknown ones generically", () => {
    const sentence = yieldSentence(
      yieldOf({
        published: 1,
        rejected: { not_standalone: 2, unresolved_reference: 1, critic_missing: 4 },
      }),
      { parts: 1, noun: "insight", nounPlural: "insights" },
    );
    expect(sentence).toBe(
      "Read 1 part · kept 1 insight · left out 4 for other reasons · left out 3 as unclear on their own",
    );
  });

  it("says so when nothing was kept", () => {
    expect(yieldSentence(yieldOf(), { parts: 4, noun: "entry", nounPlural: "entries" })).toBe(
      "Read 4 parts · Nothing worth keeping was found.",
    );
  });

  it("counts kept entries across collections", () => {
    expect(
      keptCount({
        a: yieldOf({ published: 3, publishedLowConfidence: 1 }),
        b: yieldOf({ published: 2 }),
      }),
    ).toBe(6);
  });
});

describe("bulkSummary", () => {
  const collection = { name: "Ally Guide Library", noun: "entry", nounPlural: "entries" };

  it("summarises a dry run and the toast after applying", () => {
    const summary = bulkSummary(
      {
        id: "b1",
        applied: false,
        toCreate: 38,
        toUpdate: 4,
        rejected: [
          { row: 7, reason: "body too long" },
          { row: 19, reason: "unknown topic" },
        ],
      },
      collection,
    );
    expect(summary.line).toBe("38 to create · 4 to update · 2 rejected");
    expect(summary.canApply).toBe(true);
    expect(summary.toast).toBe("Ally Guide Library: 38 entries added, 4 updated, 2 skipped");
  });

  it("has nothing to apply when every row was rejected", () => {
    const summary = bulkSummary(
      { id: "b2", applied: false, toCreate: 0, toUpdate: 0, rejected: [{ row: 2, reason: "x" }] },
      collection,
    );
    expect(summary.canApply).toBe(false);
    expect(summary.toast).toBe("Ally Guide Library: 0 entries added, 0 updated, 1 skipped");
  });
});

describe("entry hints", () => {
  it("flags length, unresolved references and names", () => {
    expect(textHints("statement", "x".repeat(170), 160)).toEqual([
      { field: "statement", message: "Keep it under 160 characters." },
    ]);
    expect(textHints("statement", "Use This approach for onboarding")[0].message).toBe(
      "Say what 'this approach' is: it's read on its own.",
    );
    expect(textHints("body", "According to the guide, ask first")[0].message).toBe(
      "No names of people or organisations.",
    );
    expect(textHints("statement", "Ask one question at a time.", 160)).toEqual([]);
  });

  it("reads gate findings from a 400, flat or nested", () => {
    const findings = [{ reason: "statement_too_long", field: "statement" }];
    expect(findingsFromError({ status: 400, data: { message: "x", findings } })).toEqual(findings);
    expect(findingsFromError({ status: 400, data: { message: { findings } } })).toEqual(findings);
    expect(findingsFromError({ status: 500, data: { message: "boom" } })).toEqual([]);
    expect(findingMessage({ reason: "attribution", field: "body" })).toBe(
      "No names of people or organisations.",
    );
  });
});

describe("small helpers", () => {
  it("splits a drop into documents and skipped files", () => {
    const { accepted, skipped } = splitDocuments([
      { name: "guide.PDF" },
      { name: "notes.docx" },
      { name: "manual.epub" },
    ]);
    expect(accepted.map(f => f.name)).toEqual(["guide.PDF", "manual.epub"]);
    expect(skipped.map(f => f.name)).toEqual(["notes.docx"]);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "103rd",
    ]);
  });

  it("humanises vocabulary values and builds the facet line", () => {
    expect(humanise("product_strategy")).toBe("Product strategy");
    expect(facetLine({ domain: "ux_ui", prdSections: ["scope", "risks", "api"] })).toBe(
      "Ux ui · Scope · Risks",
    );
  });

  it("counts documents only for extracted entries", () => {
    expect(sourceCountLine({ origin: "distilled", sourceCount: 3 })).toBe("from 3 documents");
    expect(sourceCountLine({ origin: "authored", sourceCount: 1 })).toBeNull();
  });

  it("matches facet filters any-of within a facet, all-of across facets", () => {
    const chunk = { facets: { domain: "ux_ui", prdSections: ["scope", "risks"] } };
    expect(matchesFacets(chunk, { domain: ["ux_ui", "data"] })).toBe(true);
    expect(matchesFacets(chunk, { domain: ["ux_ui"], prdSections: ["api"] })).toBe(false);
    expect(matchesFacets(chunk, { domain: [] })).toBe(true);
  });
});
