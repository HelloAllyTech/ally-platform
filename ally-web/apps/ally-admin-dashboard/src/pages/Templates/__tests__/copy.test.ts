import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { TEMPLATE_COPY, fillIn } from "../copy";

const TEXTS = readFileSync(
  resolve(__dirname, "../../../../../../../docs/agents-v2/T1-TEMPLATE-TEXTS.md"),
  "utf8",
);

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

/** The texts file writes ’ and the screens may use ' : the same word either way. */
const same = (s: string) => s.replace(/[’']/g, "'");

describe("template screen copy", () => {
  it.each(strings(TEMPLATE_COPY))("is in T1-TEMPLATE-TEXTS.md: %s", line => {
    expect(same(TEXTS)).toContain(same(line));
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(fillIn("Sets up: {lists}", { lists: "Slots" })).toBe("Sets up: Slots");
    expect(fillIn("{n} in {list}", { n: 2 })).toBe("2 in {list}");
  });
});
