import { describe, it, expect } from "vitest";

import { classifyMicrophoneError } from "../microphoneError";

const domError = (name: string, message = "x") => Object.assign(new Error(message), { name });

describe("classifyMicrophoneError", () => {
  it.each([
    ["NotAllowedError", "blocked"],
    ["PermissionDeniedError", "blocked"],
    ["SecurityError", "blocked"],
    ["NotFoundError", "notFound"],
    ["DevicesNotFoundError", "notFound"],
    ["OverconstrainedError", "notFound"],
    ["NotReadableError", "inUse"],
    ["TrackStartError", "inUse"],
    ["AbortError", "inUse"],
    ["TypeError", "unknown"],
  ])("maps %s to %s", (name, kind) => {
    expect(classifyMicrophoneError(domError(name)).kind).toBe(kind);
  });

  it("keeps the browser's name and message for the bug report", () => {
    expect(
      classifyMicrophoneError(domError("NotReadableError", "Could not start audio source")),
    ).toEqual({
      kind: "inUse",
      name: "NotReadableError",
      message: "Could not start audio source",
    });
  });

  it("survives a thrown non-Error", () => {
    expect(classifyMicrophoneError("boom")).toEqual({
      kind: "unknown",
      name: "Error",
      message: "boom",
    });
  });
});
