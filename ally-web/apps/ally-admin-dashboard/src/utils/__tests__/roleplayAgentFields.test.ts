import { describe, expect, it } from "vitest";

import {
  CHECKLIST_TYPE_OPTIONS,
  DIFFICULTY_LEVEL_OPTIONS,
  EXPERIENCE_MODE_OPTIONS,
  FORM_FIELD_IDS,
} from "@constants";
import { CHARACTER_FORM_FIELD_IDS } from "../characterApply";
import { formatSimulationResponseData } from "../createSimulation";
import { ROLEPLAY_AGENT_FIELDS, SETTING_CHOICES } from "../roleplayAgentFields";

/**
 * Every field of the roleplay form, from the three places a field is declared: the form's ids,
 * the character's ids, and what a saved roleplay loads into the form.
 */
const formFields = () =>
  new Set<string>([
    ...Object.values(FORM_FIELD_IDS),
    ...Object.values(CHARACTER_FORM_FIELD_IDS),
    ...Object.keys(formatSimulationResponseData({ metadata: {} } as any)),
  ]);

describe("roleplay agent fields", () => {
  it("says how the roleplay agent treats every field of the roleplay form", () => {
    const missing = [...formFields()].filter(id => !(id in ROLEPLAY_AGENT_FIELDS)).sort();
    // A new field on the roleplay form? Add it to ROLEPLAY_AGENT_FIELDS in
    // utils/roleplayAgentFields.ts: "text" (or "perLanguage" / "items") and the agent rewrites
    // it on request and keeps it in step when the client changes; "setting" and the agent can
    // change it on request; "trainer" or "app" with the reason it leaves it alone.
    expect(missing, `Decide how the roleplay agent handles: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists only fields the form has, and translations of fields it rewrites", () => {
    const fields = formFields();
    const stale = Object.keys(ROLEPLAY_AGENT_FIELDS).filter(id => !fields.has(id));
    expect(stale, `No longer on the form: ${stale.join(", ")}`).toEqual([]);
    for (const [id, field] of Object.entries(ROLEPLAY_AGENT_FIELDS)) {
      if (field.kind === "translation") {
        expect(ROLEPLAY_AGENT_FIELDS[field.of]?.kind, `${id} translates ${field.of}`).toBe("text");
      }
      if (field.kind === "trainer" || field.kind === "app") {
        expect(field.reason.trim(), `${id} needs a reason`).not.toBe("");
      }
    }
  });

  it("keeps every label short enough for the plan (200 characters, with a language or title added)", () => {
    for (const [id, field] of Object.entries(ROLEPLAY_AGENT_FIELDS)) {
      if ("label" in field) expect(field.label.length, id).toBeLessThanOrEqual(120);
    }
  });

  it("offers the same choices as the form", () => {
    const values = (options: { value: string }[]) => options.map(o => o.value);
    expect(SETTING_CHOICES.difficultyLevel).toEqual(values(DIFFICULTY_LEVEL_OPTIONS));
    expect(SETTING_CHOICES.experienceMode).toEqual(values(EXPERIENCE_MODE_OPTIONS));
    expect(SETTING_CHOICES.checklistType).toEqual(values(CHECKLIST_TYPE_OPTIONS));
  });
});
