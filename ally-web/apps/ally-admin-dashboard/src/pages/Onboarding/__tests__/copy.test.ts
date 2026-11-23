import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { COPY, fill } from "../copy";

const DECK = readFileSync(
  resolve(__dirname, "../../../../../../../docs/agents-v2/ONBOARDING-COPY.md"),
  "utf8",
);

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];

describe("onboarding copy", () => {
  it.each(strings(COPY))("is the deck's: %s", line => {
    expect(DECK).toContain(line.replace(/:$/, ""));
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(fill("Read {n} of {max}", { n: 3 })).toBe("Read 3 of {max}");
  });
});
