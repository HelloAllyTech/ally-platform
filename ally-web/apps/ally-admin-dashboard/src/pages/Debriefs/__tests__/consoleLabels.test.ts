import { describe, expect, it } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import {
  canaryReasonLabel,
  checkLabel,
  codeWords,
  hardFailLabel,
  inWords,
  languageLabel,
  modelLabels,
  promptName,
  recipeLabel,
  sectionLabel,
  settingChangeLabel,
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
    ).toBe("Try-out share of new debriefs: change to 25%");
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

describe("inWords", () => {
  it("names the codes the PM agent writes, and leaves prose alone", () => {
    expect(inWords("analyst.fail_rate down")).toBe("Analyst: failure rate down");
    expect(inWords("Expected: hard_fail_rate down")).toBe("Expected: Hard-fail rate down");
    expect(inWords("leading to `missed_risk_cue` hard fails")).not.toContain("missed_risk_cue");
    expect(inWords("The analyst and safety_reader steps")).toBe(
      "The analyst and Safety reader steps",
    );
    expect(inWords("an unknown_code_here stays, as does plain text.")).toBe(
      "an unknown_code_here stays, as does plain text.",
    );
    expect(inWords(null)).toBe("");
  });
});

describe("Debriefs home labels", () => {
  it("names every category (a missing key leaves a blank switch)", async () => {
    const { HOME_CATEGORIES } = await import("../queue");
    const { en } = await import("@constants");
    for (const id of HOME_CATEGORIES) {
      expect(en.debriefs.home.categories[id], id).toBeTruthy();
      expect(en.debriefs.home.empty[id]?.title, id).toBeTruthy();
    }
  });
});

describe("the Debriefs home's opening category", () => {
  it("opens a clinical advisor (not on the Ally team) on Escalated to you, else the Agreement sample", async () => {
    const { defaultCategory } = await import("../queue");
    const base = {
      team: false,
      owner: false,
      advisor: true,
      receivesEscalations: true,
      verdict: true,
    };
    expect(defaultCategory(base)).toBe("escalated");
    expect(defaultCategory({ ...base, receivesEscalations: false })).toBe("agreement");
    expect(defaultCategory({ ...base, team: true })).toBe("needs");
    expect(defaultCategory({ ...base, owner: true })).toBe("needs");
    expect(defaultCategory({ ...base, advisor: false })).toBe("needs");
  });
});
