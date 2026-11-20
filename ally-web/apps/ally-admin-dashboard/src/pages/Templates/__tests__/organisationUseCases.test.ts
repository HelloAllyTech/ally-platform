import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { en } from "@constants";

import USE_CASES from "../../../constants/organisationUseCases.json";

/**
 * T1: the sign-in page's "What organisations use it for" and the organisation templates read one
 * source, ally-be's `organisation-use-cases.json`. This app carries a copy (its build can't reach
 * ally-be); these fail if the copy, or the sign-in page, drifts from it.
 */
const BE = resolve(
  __dirname,
  "../../../../../../../ally-be/src/chatbot/templates/organisation-use-cases.json",
);

describe("organisation use cases: one source", () => {
  it("this app's copy is ally-be's, byte for byte", () => {
    expect(
      readFileSync(resolve(__dirname, "../../../constants/organisationUseCases.json"), "utf8"),
    ).toBe(readFileSync(BE, "utf8"));
  });

  it("the sign-in page shows them, in order, with the same names and one-liners", () => {
    expect(
      en.assistantsShell.login.useCases.map(u => ({ id: u.id, title: u.title, blurb: u.blurb })),
    ).toEqual(USE_CASES);
  });
});
