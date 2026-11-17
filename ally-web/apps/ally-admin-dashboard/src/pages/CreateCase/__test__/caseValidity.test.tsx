import { describe, expect, it } from "vitest";

import { areCaseFieldsFilled, isMandatoryValueFilled } from "../caseValidity";

describe("isMandatoryValueFilled", () => {
  it("treats a non-empty array as filled (it used to read as unfilled)", () => {
    expect(isMandatoryValueFilled(["a"])).toBe(true);
  });
  it("treats empty values as unfilled", () => {
    expect(isMandatoryValueFilled([])).toBe(false);
    expect(isMandatoryValueFilled("")).toBe(false);
    expect(isMandatoryValueFilled(undefined)).toBe(false);
  });
  it("accepts a plain filled string", () => {
    expect(isMandatoryValueFilled("A title")).toBe(true);
  });
});

describe("areCaseFieldsFilled", () => {
  it("is valid with every mandatory field and exactly one simulation", () => {
    expect(areCaseFieldsFilled(["title"], { title: "T", scenarios: [{ id: 1 }] })).toBe(true);
  });
  it("is invalid with no simulation", () => {
    expect(areCaseFieldsFilled(["title"], { title: "T", scenarios: [] })).toBe(false);
  });
  it("is invalid when a mandatory field is missing", () => {
    expect(areCaseFieldsFilled(["title"], { scenarios: [{ id: 1 }] })).toBe(false);
  });
});
