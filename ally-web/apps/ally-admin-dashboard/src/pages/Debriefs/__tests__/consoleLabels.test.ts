import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import {
  canaryReasonLabel,
  checkLabel,
  codeWords,
  hardFailLabel,
  languageLabel,
  modelLabels,
  promptName,
  recipeLabel,
  sectionLabel,
  settingChangeLabel,
  skipReasonLabel,
  stepName,
} from "../consoleLabels";

describe("console labels", () => {
  it("turns an unlisted code into words, never the raw id", () => {
    expect(codeWords("missed_risk_cue")).toBe("Missed risk cue");
    expect(codeWords("DEBRIEF_WRITER")).toBe("Debrief writer");
    expect(codeWords(null)).toBe("—");
    expect(checkLabel("brand_new_check")).toBe("Brand new check");
    expect(hardFailLabel("brand_new_fail")).toBe("Brand new fail");
  });

  it("reads each map first", () => {
    expect(checkLabel("quote_mismatch")).toBe("Quote doesn't match what was said");
    expect(hardFailLabel("wrong_language")).toBe("Not in the session's language");
    expect(stepName("progress_reader")).toBe("Progress reader");
    expect(stepName("ask_ally")).toBe("Ask Ally");
    expect(recipeLabel("short")).toBe("Short session");
    expect(skipReasonLabel("too_short")).toBe("The learner said nothing");
    expect(promptName("debrief_writer_system")).toBe("Writer's prompt");
  });

  it("names a language by its code, with or without the region, else shows the code", () => {
    expect(languageLabel("hi-IN")).toBe("Hindi");
    expect(languageLabel("ta")).toBe("Tamil");
    expect(languageLabel("or-IN")).toBe("Odia");
    expect(languageLabel("xx-YY")).toBe("xx-YY");
    expect(languageLabel(null)).toBe("—");
  });

  it("names a card section by its path", () => {
    expect(sectionLabel("opening")).toBe("Opening");
    expect(sectionLabel("what_worked[0]")).toBe("What worked, point 1");
    expect(sectionLabel("work_on_this.2")).toBe("Work on this, point 3");
    expect(sectionLabel("important_moment.others[1]")).toBe("An important moment, other moment 2");
    expect(sectionLabel("brand_new")).toBe("Brand new");
  });

  it("states a proposed setting the way the Settings tab shows it", () => {
    expect(
      settingChangeLabel("canaryShare", "0.25", { default: 0.1, kind: "share", group: "canary" }),
    ).toBe("Share of live debriefs on the canary: change to 25%");
    expect(
      settingChangeLabel("gateNoNewHardFails", "0", { default: true, kind: "bool", group: "gate" }),
    ).toBe("No new hard fails: change to No");
    expect(settingChangeLabel("someNewKey", "3")).toBe("Somenewkey: change to 3");
  });

  it("keeps a canary's written reason and labels its codes", () => {
    expect(canaryReasonLabel("learning_budget")).toBe(
      "The learning budget for this month is spent",
    );
    expect(canaryReasonLabel("it finished below the release in force")).toBe(
      "it finished below the release in force",
    );
  });

  it("names a model by the catalog's label, falling back to its id", () => {
    const label = modelLabels({
      releaseVersion: 1,
      steps: [],
      reply: "a",
      judge: "j",
      choices: { steps: [{ model: "m1", label: "Model One", provider: null }], reply: [] },
    });
    expect(label("m1")).toBe("Model One");
    expect(label("unknown-model")).toBe("unknown-model");
  });
});
