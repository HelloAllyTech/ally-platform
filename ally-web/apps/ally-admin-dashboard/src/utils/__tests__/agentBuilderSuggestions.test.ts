import { describe, expect, it } from "vitest";

import { recommendMode, suggestNextSteps } from "../agentBuilderSuggestions";

describe("recommendMode", () => {
  it.each([
    ["A final check before certification", "post_assessment", "assessmentAfter"],
    ["Baseline roleplay before the course starts", "pre_assessment", "assessmentBefore"],
    ["Learners show the skill on their own with a real-world caller", "performance", "performance"],
    ["A cooperative student, the learner's first try", "learning", "firstTry"],
    ["Meera calls a helpline late at night", "practice", "practice"],
  ])("%s → %s", (description, mode, reason) => {
    expect(recommendMode(description)).toEqual({ mode, reason });
  });

  it("reads only the description, never a competency name", () => {
    // @ts-expect-error a second argument is not accepted any more
    expect(recommendMode("Meera calls a helpline", "Assessment of Harm").mode).toBe("practice");
  });

  it("prefers the baseline reading over the generic assessment one", () => {
    expect(recommendMode("a pre-test assessment").mode).toBe("pre_assessment");
  });
});

const complete = {
  title: "Aarav",
  openingStatements: "Hi.",
  languageVoices: { "1": "voice-1" },
  states: [{}, {}, {}, {}],
  reminders: "Slow down\nAsk directly\nReflect feelings",
  remindersEnabled: true,
};

describe("suggestNextSteps", () => {
  it("only suggests a preview when nothing is missing", () => {
    expect(suggestNextSteps(complete, "learning").map(s => s.key)).toEqual(["preview"]);
  });

  it("names what is missing, most important first", () => {
    const keys = suggestNextSteps(
      { states: [{}, {}], reminders: "One", remindersEnabled: true },
      "practice",
    ).map(s => s.key);
    expect(keys).toEqual([
      "noTitle",
      "noOpening",
      "noVoice",
      "fewStates",
      "fewReminders",
      "preview",
    ]);
  });

  it("reads opening lines in other languages and flags a long first one", () => {
    const steps = suggestNextSteps(
      {
        ...complete,
        openingStatements: "",
        translationOpeningStatements: { "2": ["x".repeat(300)] },
      },
      "learning",
    );
    expect(steps.map(s => s.key)).toEqual(["longOpening", "preview"]);
  });

  it("flags supports left on in an assessment roleplay", () => {
    const steps = suggestNextSteps({ ...complete, currentState: true }, "post_assessment");
    expect(steps.map(s => s.key)).toContain("supportsInAssessment");
  });

  it("counts states and reminders for the message", () => {
    const steps = suggestNextSteps(
      { ...complete, states: [{}], reminders: "", remindersEnabled: true },
      "learning",
    );
    expect(steps.find(s => s.key === "fewStates")?.count).toBe(1);
    expect(steps.find(s => s.key === "fewReminders")?.count).toBe(0);
  });
});
