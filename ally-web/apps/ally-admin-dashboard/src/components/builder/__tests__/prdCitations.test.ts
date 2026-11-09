import { describe, expect, it } from "vitest";

import {
  citationCodeFromHref,
  citationHref,
  isCitationCode,
  linkCitations,
  splitCitations,
} from "../prdCitations";

describe("citationHref / citationCodeFromHref", () => {
  it("round-trips a code through the Context Library link", () => {
    expect(citationHref("FP-0142")).toBe("/context-library?chunk=FP-0142");
    expect(citationCodeFromHref("/context-library?chunk=FP-0142")).toBe("FP-0142");
  });

  it("leaves every other link alone", () => {
    expect(citationCodeFromHref("https://example.org/context-library?chunk=FP-0142")).toBeNull();
    expect(citationCodeFromHref("/context-library?chunk=not-a-code")).toBeNull();
    expect(citationCodeFromHref("/context-library?chunk=%E0%A4%A")).toBeNull();
    expect(citationCodeFromHref(undefined)).toBeNull();
  });

  it("knows a code when it sees one", () => {
    expect(isCitationCode("FP-0142")).toBe(true);
    expect(isCitationCode("BL-12345")).toBe(true);
    expect(isCitationCode("FP-12")).toBe(false);
    expect(isCitationCode("fp-0142")).toBe(false);
  });
});

describe("linkCitations", () => {
  it("links one code, and each code in a list", () => {
    expect(linkCitations("Show the payoff [FP-0142].")).toBe(
      "Show the payoff [FP-0142](/context-library?chunk=FP-0142).",
    );
    expect(linkCitations("Both apply [FP-0142, FP-0007].")).toBe(
      "Both apply [FP-0142](/context-library?chunk=FP-0142) [FP-0007](/context-library?chunk=FP-0007).",
    );
  });

  it("leaves code, existing links and other brackets exactly as written", () => {
    const untouched = [
      "Use `[FP-0142]` to cite.",
      "```\nconst cite = '[FP-0142]';\n```",
      "Already linked: [FP-0142](https://example.org).",
      "[FP-0142]: https://example.org",
      "A task list [x] and a [link](https://example.org).",
      "Too short [FP-12].",
    ];
    for (const text of untouched) expect(linkCitations(text)).toBe(text);
  });

  it("links prose around a fenced block but not inside it", () => {
    const text = "Before [FP-0001].\n\n```\n[FP-0002]\n```\n\nAfter [FP-0003].";
    expect(linkCitations(text)).toBe(
      "Before [FP-0001](/context-library?chunk=FP-0001).\n\n```\n[FP-0002]\n```\n\nAfter [FP-0003](/context-library?chunk=FP-0003).",
    );
  });

  it("copes with empty and odd input", () => {
    expect(linkCitations("")).toBe("");
    expect(linkCitations(undefined as unknown as string)).toBe("");
  });
});

describe("splitCitations", () => {
  it("splits plain text into text and codes", () => {
    expect(splitCitations("Ask once [FP-0001, FP-0002] then stop")).toEqual([
      { kind: "text", text: "Ask once " },
      { kind: "code", code: "FP-0001" },
      { kind: "text", text: " " },
      { kind: "code", code: "FP-0002" },
      { kind: "text", text: " then stop" },
    ]);
  });

  it("returns the text alone when nothing is cited", () => {
    expect(splitCitations("Nothing cited here")).toEqual([
      { kind: "text", text: "Nothing cited here" },
    ]);
    expect(splitCitations("")).toEqual([]);
  });
});
