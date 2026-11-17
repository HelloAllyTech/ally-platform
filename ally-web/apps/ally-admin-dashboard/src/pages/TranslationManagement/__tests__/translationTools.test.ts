import { describe, expect, it } from "vitest";

import {
  computePendingChanges,
  isMissing,
  MISSING_ANY,
  parseCsv,
  planImport,
  toCsv,
} from "../translationTools";

const row = (key: string, values: Record<string, string>, liveValues: Record<string, string>) => ({
  fullKey: `common.${key}`,
  namespace: "common",
  innerKey: key,
  placeholders: [],
  values,
  liveValues,
});

const rows = [
  row("a", { en: "Hi", hi: "नमस्ते" }, { en: "Hi", hi: "नमस्ते" }),
  row("b", { en: "Bye", hi: "" }, { en: "Bye" }),
  row("c", { en: 'Say "x", ok', hi: "z" }, { en: "old", hi: "z" }),
];

describe("translationTools", () => {
  it("lists only saved drafts that differ from live", () => {
    const pending = computePendingChanges(rows, ["en", "hi"]);
    expect(pending.map(p => `${p.fullKey}:${p.language}`)).toEqual(["common.c:en"]);
  });
  it("finds missing translations", () => {
    expect(rows.filter(r => isMissing(r, ["en", "hi"], MISSING_ANY)).map(r => r.innerKey)).toEqual([
      "b",
    ]);
  });
  it("round-trips CSV with quotes and commas", () => {
    expect(parseCsv(toCsv(rows, ["en", "hi"]))[3]).toEqual(["common.c", 'Say "x", ok', "z"]);
  });
  it("plans an import against current drafts", () => {
    const plan = planImport(
      [
        ["key", "en", "fr"],
        ["common.a", "Hello", "x"],
        ["nope.k", "q", "q"],
      ],
      rows,
      ["en", "hi"],
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      fullKey: "common.a",
      language: "en",
      draft: "Hello",
      current: "Hi",
    });
    expect(plan.unknownKeys).toEqual(["nope.k"]);
    expect(plan.unknownLanguages).toEqual(["fr"]);
  });
});
