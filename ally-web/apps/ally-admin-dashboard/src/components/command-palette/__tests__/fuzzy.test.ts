import { describe, expect, it } from "vitest";

import { fuzzyFilter, fuzzyScore } from "../fuzzy";

describe("fuzzyScore", () => {
  it("matches characters in order, ignoring case and spaces", () => {
    expect(fuzzyScore("rlp", "Roleplays")).not.toBeNull();
    expect(fuzzyScore("ai t", "AI Tasks")).not.toBeNull();
    expect(fuzzyScore("ROLE", "roleplays")).not.toBeNull();
  });

  it("returns null when the letters are not all there in order", () => {
    expect(fuzzyScore("zq", "Roleplays")).toBeNull();
    expect(fuzzyScore("syalp", "Roleplays")).toBeNull();
  });

  it("scores a prefix above a scattered match", () => {
    expect(fuzzyScore("use", "Users")!).toBeGreaterThan(
      fuzzyScore("use", "Unit Statistics Engine")!,
    );
  });
});

describe("fuzzyFilter", () => {
  const items = [
    { id: "a", label: "Analytics", keywords: ["Insights"] },
    { id: "b", label: "AI Tasks", keywords: ["AI & Languages"] },
    { id: "c", label: "Languages", keywords: ["AI & Languages"] },
    { id: "d", label: "Conversation Drift", keywords: ["Insights"] },
  ];

  it("returns everything in order for an empty query", () => {
    expect(fuzzyFilter(items, "  ").map(i => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("ranks the best label first", () => {
    expect(fuzzyFilter(items, "lang")[0].id).toBe("c");
    expect(fuzzyFilter(items, "drift")[0].id).toBe("d");
  });

  it("finds an item by its section when its label does not match, but ranks label hits higher", () => {
    const ids = fuzzyFilter(items, "insights").map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(["a", "d"]));
    expect(ids).not.toContain("c");
  });

  it("is stable for equal scores", () => {
    const same = [
      { id: "1", label: "Aaa" },
      { id: "2", label: "Aaa" },
    ];
    expect(fuzzyFilter(same, "aa").map(i => i.id)).toEqual(["1", "2"]);
  });
});
