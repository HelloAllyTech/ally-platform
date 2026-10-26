import { describe, expect, it } from "vitest";

import { diffLines, placeholdersIn } from "../promptVersionText";

describe("placeholdersIn", () => {
  it("lists each placeholder once, in order of first use", () => {
    expect(placeholdersIn("Hi {name}, you are {age}. Bye {name}.")).toEqual(["name", "age"]);
  });

  it("reads the inner name of a double-braced placeholder", () => {
    expect(placeholdersIn("Title: {{course_title}}")).toEqual(["course_title"]);
  });

  it("ignores braces that hold no name, like a JSON example", () => {
    expect(placeholdersIn('Return {"notes": "…"} and {{ "a": 1 }}')).toEqual([]);
  });
});

describe("diffLines", () => {
  it("marks unchanged, removed and added lines", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("reports no change for identical text", () => {
    expect(diffLines("x\ny", "x\ny").every(l => l.kind === "same")).toBe(true);
  });
});
