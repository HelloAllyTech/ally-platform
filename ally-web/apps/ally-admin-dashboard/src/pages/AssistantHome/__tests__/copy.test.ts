import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { HOME } from "../copy";

const DECK = readFileSync(
  resolve(__dirname, "../../../../../../../docs/agents-v2/ONBOARDING-COPY.md"),
  "utf8",
);

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

describe("assistant home copy", () => {
  it.each(strings(HOME))("is the deck's: %s", line => {
    expect(DECK).toContain(line);
  });

  it("never says model to owners", () => {
    expect(strings(HOME).filter(line => /\bmodel\b/i.test(line))).toEqual([]);
  });
});
