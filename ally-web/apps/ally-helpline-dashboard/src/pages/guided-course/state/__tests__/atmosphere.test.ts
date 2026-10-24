import { describe, expect, it } from "vitest";

import { capTone, dockVisible, proseBudget, replyVerbsFor, resolveAtmosphere } from "../atmosphere";
import { failureCodeFromHttp, failureStateFor, FAILURE_STATES } from "../failureStates";
import { GUIDE_FAILURE_CODE_VALUES } from "../../contract/wire";

describe("resolveAtmosphere", () => {
  it("is bright by default", () => {
    expect(
      resolveAtmosphere({ mode: "NORMAL", serverAtmosphere: "bright", sceneHasWarnings: false }),
    ).toBe("bright");
  });

  it("hushes a chapter with trigger warnings even when the thread is NORMAL", () => {
    expect(
      resolveAtmosphere({ mode: "NORMAL", serverAtmosphere: "bright", sceneHasWarnings: true }),
    ).toBe("hushed");
  });

  it("hushes CARE and CRISIS_FOLLOWUP and stills CRISIS whatever the server sent", () => {
    expect(
      resolveAtmosphere({ mode: "CARE", serverAtmosphere: "bright", sceneHasWarnings: false }),
    ).toBe("hushed");
    expect(
      resolveAtmosphere({
        mode: "CRISIS_FOLLOWUP",
        serverAtmosphere: "bright",
        sceneHasWarnings: false,
      }),
    ).toBe("hushed");
    expect(
      resolveAtmosphere({ mode: "CRISIS", serverAtmosphere: "hushed", sceneHasWarnings: false }),
    ).toBe("still");
  });

  it("never makes the room louder than the server asked", () => {
    expect(
      resolveAtmosphere({ mode: "NORMAL", serverAtmosphere: "still", sceneHasWarnings: false }),
    ).toBe("still");
    expect(
      resolveAtmosphere({ mode: "NORMAL", serverAtmosphere: "hushed", sceneHasWarnings: false }),
    ).toBe("hushed");
  });
});

describe("capTone", () => {
  it("passes the tone through in a bright room", () => {
    expect(capTone("festive", "bright", "NORMAL")).toBe("festive");
    expect(capTone(undefined, "bright", "NORMAL")).toBe("quiet");
  });

  it("caps at quiet when hushed", () => {
    expect(capTone("festive", "hushed", "NORMAL")).toBe("quiet");
    expect(capTone("warm", "hushed", "CARE")).toBe("quiet");
  });

  it("suppresses celebration in CRISIS and CRISIS_FOLLOWUP", () => {
    expect(capTone("festive", "still", "CRISIS")).toBe("none");
    expect(capTone("warm", "hushed", "CRISIS_FOLLOWUP")).toBe("none");
  });
});

describe("guidance dial", () => {
  it("maps each setting to its prose budget", () => {
    expect(proseBudget("lead")).toBe(90);
    expect(proseBudget("walk")).toBe(60);
    expect(proseBudget("drive")).toBe(25);
  });
});

describe("dockVisible", () => {
  const nextStep = { hidden: false, itemId: "i2" };
  it("shows only in a bright NORMAL room with a visible next step", () => {
    expect(dockVisible({ atmosphere: "bright", mode: "NORMAL", nextStep })).toBe(true);
    expect(dockVisible({ atmosphere: "hushed", mode: "NORMAL", nextStep })).toBe(false);
    expect(dockVisible({ atmosphere: "bright", mode: "CARE", nextStep })).toBe(false);
    expect(
      dockVisible({
        atmosphere: "bright",
        mode: "NORMAL",
        nextStep: { hidden: true, itemId: "i2" },
      }),
    ).toBe(false);
    expect(dockVisible({ atmosphere: "bright", mode: "NORMAL", nextStep: null })).toBe(false);
  });
});

describe("replyVerbsFor", () => {
  it("offers the standard verbs, plus 'not what I meant' right after Ally answers", () => {
    expect(
      replyVerbsFor({ mode: "NORMAL", atmosphere: "bright", allyJustAnswered: false }),
    ).toEqual(["tellMore", "example", "notSure", "notNow", "tryIt"]);
    expect(
      replyVerbsFor({ mode: "NORMAL", atmosphere: "bright", allyJustAnswered: true }).at(-1),
    ).toBe("notWhatIMeant");
  });

  it("swaps to the fixed CARE chips, and shows none when still", () => {
    expect(replyVerbsFor({ mode: "CARE", atmosphere: "hushed", allyJustAnswered: true })).toEqual([
      "breathe",
      "talk",
      "supportOptions",
      "backToCourse",
    ]);
    expect(replyVerbsFor({ mode: "CRISIS", atmosphere: "still", allyJustAnswered: false })).toEqual(
      [],
    );
  });
});

describe("failure states", () => {
  it("designs a state for every failure code in the contract", () => {
    for (const code of GUIDE_FAILURE_CODE_VALUES) {
      expect(FAILURE_STATES[code], code).toBeDefined();
    }
  });

  it("offers a way forward for every failure that is Ally's", () => {
    expect(failureStateFor("internal_error").action).toBe("retry");
    expect(failureStateFor("interrupted").action).toBe("retry");
    expect(failureStateFor("provider_unavailable").action).toBe("classic");
    expect(failureStateFor("something_new").copyKey).toBe("guide.failure.turnFailed");
  });

  it("maps HTTP refusals onto the stream's codes", () => {
    expect(failureCodeFromHttp(403, "GUIDE_DISABLED")).toBe("guide_disabled");
    expect(failureCodeFromHttp(403, "GUIDE_NO_ACCESS")).toBe("no_access");
    expect(failureCodeFromHttp(400, "GUIDE_MESSAGE_TOO_LONG")).toBe("message_too_long");
    expect(failureCodeFromHttp(429, undefined)).toBe("rate_limited");
    expect(failureCodeFromHttp(503, undefined)).toBe("provider_unavailable");
    expect(failureCodeFromHttp(500, undefined)).toBe("internal_error");
  });
});
