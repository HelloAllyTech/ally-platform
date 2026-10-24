import { describe, expect, it } from "vitest";

import { AllyGuideConfigLayerField } from "@types";

import {
  buildChange,
  changeCount,
  describeValue,
  effectiveValue,
  groupFields,
  isEmptyChange,
  messagesForKey,
  NULL_CHOICE,
  parseInput,
  readSaveFailure,
  toInput,
} from "../configDraft";

const field = (overrides: Partial<AllyGuideConfigLayerField> = {}): AllyGuideConfigLayerField => ({
  key: "releaseWindowMaxTurns",
  type: "int",
  min: 1,
  max: 20,
  description: "How many turns a release window stays open.",
  overridableBy: ["org", "course"],
  group: "Steering",
  releaseValue: 6,
  override: null,
  ...overrides,
});

describe("parseInput", () => {
  it("reads an integer within its limits", () => {
    expect(parseInput(field(), "8")).toEqual({ ok: true, value: 8 });
    expect(parseInput(field(), " 1 ")).toEqual({ ok: true, value: 1 });
    expect(parseInput(field(), "20")).toEqual({ ok: true, value: 20 });
  });

  it("refuses text that is not plainly an integer, rather than rounding it", () => {
    for (const text of ["12.5", "2e1", "six", "1 0"]) {
      expect(parseInput(field(), text)).toEqual({ ok: false, error: "integer" });
    }
  });

  it("refuses a value outside the limits, saying which side", () => {
    expect(parseInput(field(), "0")).toEqual({ ok: false, error: "min" });
    expect(parseInput(field(), "21")).toEqual({ ok: false, error: "max" });
  });

  it("asks for a value on an empty box, unless the key allows null, where empty means off", () => {
    expect(parseInput(field(), "")).toEqual({ ok: false, error: "required" });
    expect(parseInput(field({ nullable: true }), "")).toEqual({ ok: true, value: null });
  });

  it("reads a decimal for a number key", () => {
    const decimal = field({ type: "number", min: 0, max: 1, releaseValue: 0.5 });
    expect(parseInput(decimal, "0.25")).toEqual({ ok: true, value: 0.25 });
    expect(parseInput(decimal, "abc")).toEqual({ ok: false, error: "number" });
  });

  it("reads a boolean from its flag", () => {
    const flag = field({ type: "boolean", releaseValue: false });
    expect(parseInput(flag, true)).toEqual({ ok: true, value: true });
    expect(parseInput(flag, false)).toEqual({ ok: true, value: false });
  });

  it("accepts only a listed choice for an enum, and null only where allowed", () => {
    const choice = field({ type: "enum", enum: ["a", "b"], releaseValue: "a" });
    expect(parseInput(choice, "b")).toEqual({ ok: true, value: "b" });
    expect(parseInput(choice, "z")).toEqual({ ok: false, error: "choice" });
    expect(parseInput(choice, NULL_CHOICE)).toEqual({ ok: false, error: "choice" });
    expect(parseInput({ ...choice, nullable: true }, NULL_CHOICE)).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("effectiveValue and toInput", () => {
  it("runs on the override when there is one, and on the release otherwise", () => {
    expect(effectiveValue(field())).toBe(6);
    expect(effectiveValue(field({ override: { value: 9 } }))).toBe(9);
  });

  it("shows null as an empty box, or as the off choice for an enum", () => {
    expect(toInput(field(), null)).toBe("");
    expect(toInput(field({ type: "enum", enum: ["a"] }), null)).toBe(NULL_CHOICE);
    expect(toInput(field({ type: "boolean" }), true)).toBe(true);
    expect(toInput(field(), 6)).toBe("6");
  });
});

describe("buildChange", () => {
  const fields = [
    field(),
    field({ key: "other", releaseValue: 3, override: { value: 5 } }),
    field({ key: "flag", type: "boolean", releaseValue: false }),
  ];

  it("sets a key edited away from the release value", () => {
    expect(buildChange(fields, { releaseWindowMaxTurns: "8" }, new Set())).toEqual({
      set: { releaseWindowMaxTurns: 8 },
      clear: [],
    });
  });

  it("writes nothing for a key set to what it already runs on", () => {
    expect(buildChange(fields, { releaseWindowMaxTurns: "6", other: "5" }, new Set())).toEqual({
      set: {},
      clear: [],
    });
  });

  it("clears an overridden key edited back to the release value", () => {
    expect(buildChange(fields, { other: "3" }, new Set())).toEqual({ set: {}, clear: ["other"] });
  });

  it("clears an overridden key on reset, and ignores a reset of one that was never overridden", () => {
    expect(buildChange(fields, {}, new Set(["other", "releaseWindowMaxTurns"]))).toEqual({
      set: {},
      clear: ["other"],
    });
  });

  it("a reset beats an edit to the same key", () => {
    expect(buildChange(fields, { other: "9" }, new Set(["other"]))).toEqual({
      set: {},
      clear: ["other"],
    });
  });

  it("leaves out a key whose text is not valid, rather than sending half of it", () => {
    expect(buildChange(fields, { releaseWindowMaxTurns: "99" }, new Set())).toEqual({
      set: {},
      clear: [],
    });
  });

  it("sets a boolean turned on", () => {
    expect(buildChange(fields, { flag: true }, new Set())).toEqual({
      set: { flag: true },
      clear: [],
    });
  });

  it("counts the keys touched and knows an empty change", () => {
    const change = buildChange(fields, { releaseWindowMaxTurns: "8", other: "3" }, new Set());
    expect(changeCount(change)).toBe(2);
    expect(isEmptyChange(change)).toBe(false);
    expect(isEmptyChange({ set: {}, clear: [] })).toBe(true);
  });
});

describe("readSaveFailure", () => {
  it("reads a refusal as one message per key", () => {
    expect(
      readSaveFailure({
        status: 400,
        data: {
          errorCode: "GUIDE_CONFIG_REFUSED",
          message: ["a is above 20", "b is not a setting"],
        },
      }),
    ).toEqual({ kind: "refused", messages: ["a is above 20", "b is not a setting"] });
  });

  it("reads a 409 as a stale save", () => {
    expect(
      readSaveFailure({ status: 409, data: { message: "Someone else changed these" } }),
    ).toEqual({ kind: "stale" });
  });

  it("falls back to the server's message for anything else, or to nothing", () => {
    expect(readSaveFailure({ status: 404, data: { message: "Course not found" } })).toEqual({
      kind: "other",
      message: "Course not found",
    });
    expect(readSaveFailure({ status: 500 })).toEqual({ kind: "other", message: null });
    expect(readSaveFailure(undefined)).toEqual({ kind: "other", message: null });
  });
});

describe("messagesForKey", () => {
  it("picks the sentences that start with the key and not a key that merely shares its start", () => {
    const messages = ["limits.max is above 20", "limits.maxTurns must be whole"];

    expect(messagesForKey(messages, "limits.max")).toEqual(["limits.max is above 20"]);
  });
});

describe("groupFields and describeValue", () => {
  it("keeps groups in the order they first appear", () => {
    const groups = groupFields([
      { group: "B", key: "1" },
      { group: "A", key: "2" },
      { group: "B", key: "3" },
    ]);

    expect(groups.map(([name, items]) => [name, items.length])).toEqual([
      ["B", 2],
      ["A", 1],
    ]);
  });

  it("writes null as off, booleans as yes or no, and a number with its unit", () => {
    expect(describeValue(null)).toBe("Off");
    expect(describeValue(true)).toBe("Yes");
    expect(describeValue(false)).toBe("No");
    expect(describeValue(90, "words")).toBe("90 words");
    expect(describeValue(6)).toBe("6");
  });
});
