import { describe, expect, it, vi } from "vitest";

// Neither barrel is loaded for real: both reach `@store` at module load.
vi.mock("@api", () => ({
  useEnhanceFieldMutation: () => [vi.fn()],
  useGetAvailableLanguageVoicesQuery: () => ({ data: [] }),
  useRevisePlanMutation: () => [vi.fn()],
}));
vi.mock("@constants", () => ({
  en: {
    agentBuilderRevision: {
      characterDetails: "Character details",
      settings: "Settings",
      noSettingChanged: "no setting needed changing",
    },
  },
}));

import {
  acceptSetting,
  CHARACTER_DETAILS_ID,
  describeCharacterChange,
  SETTINGS_ID,
  readRevisableFields,
  voicesForGender,
} from "../useAgentBuilderRevision";

const catalog = [
  {
    language_id: 1,
    label: "English (India)",
    voices: [
      { id: "arjun", gender: "Male" },
      { id: "kavya", gender: "Female" },
    ],
  },
  { language_id: 2, label: "Hindi (India)", voices: [{ id: "rohan", gender: "male" }] },
  { language_id: 3, label: "Tamil", voices: [{ id: "neutral" }] },
];

describe("voicesForGender", () => {
  it("swaps a voice of the old gender for one of the new gender in the same language", () => {
    const { voices, unmatched } = voicesForGender(
      { "1": "arjun", "2": "rohan", "3": "neutral" },
      "female",
      catalog,
    );
    expect(voices).toEqual({ "1": "kavya", "2": "rohan", "3": "neutral" });
    expect(unmatched).toEqual(["Hindi (India)"]);
  });

  it("keeps voices that already fit", () => {
    expect(voicesForGender({ "1": "kavya" }, "female", catalog).voices).toEqual({ "1": "kavya" });
  });
});

describe("readRevisableFields", () => {
  const form = (values: Record<string, unknown>) =>
    ({ getValues: (key: string) => values[key] }) as any;

  it("offers the character details as one JSON field", () => {
    const fields = readRevisableFields(
      form({ prompt: "Be Arjun.", name: "Arjun", age: 22, gender: "male" }),
    );
    const details = fields.find(field => field.id === CHARACTER_DETAILS_ID);
    expect(JSON.parse(details!.value)).toMatchObject({ name: "Arjun", age: 22, gender: "male" });
  });

  it("leaves them out before a character exists", () => {
    const fields = readRevisableFields(form({ prompt: "Be someone." }));
    expect(fields.map(field => field.id)).toEqual(["roleInstruction"]);
  });
});

describe("describeCharacterChange", () => {
  it("makes the new name an instruction and the rest reference", () => {
    const text = describeCharacterChange(
      { name: "Arjun", age: 22, gender: "male" },
      { name: "Ananya", age: 22, gender: "female", genderIdentity: "Female/Woman" },
    );
    expect(text).toContain('use exactly "Ananya"');
    expect(text).toContain('(it was "Arjun")');
    expect(text).toContain("gender female");
    expect(text).toContain("never add them");
  });

  it("gives no name instruction when the name stays", () => {
    expect(
      describeCharacterChange({ name: "Arjun", age: 22 }, { name: "Arjun", age: 30 }),
    ).not.toContain("use exactly");
  });
});

describe("fields from the registry", () => {
  const form = (values: Record<string, unknown>) =>
    ({ getValues: (key: string) => values[key] }) as any;
  const catalog = [
    { language_id: 1, label: "English (India)", value: "en-IN" },
    { language_id: 2, label: "Hindi (India)", value: "hi-IN" },
  ] as any;

  it("offers every kind of field the registry lists, by the id the plan uses", () => {
    const fields = readRevisableFields(
      form({
        prompt: "Be Arjun.",
        context: "A late call.",
        linguisticStyleSamples: { "2": ["Main theek hoon."] },
        knowledgeSources: [{ id: "k1", title: "Family", content: "His parents live in Nagpur." }],
        difficultyLevel: "MEDIUM",
        showScoreMeter: true,
        temperature: 0.7,
      }),
      catalog,
    );
    const byId = Object.fromEntries(fields.map(field => [field.id, field]));
    expect(byId.roleInstruction.value).toBe("Be Arjun.");
    expect(byId.context.value).toBe("A late call.");
    expect(byId["linguisticStyleSamples:2"].label).toContain("Hindi (India)");
    expect(byId["knowledgeSources:k1"].value).toBe("His parents live in Nagpur.");
    expect(JSON.parse(byId[SETTINGS_ID].value)).toEqual({
      difficultyLevel: "MEDIUM",
      showScoreMeter: true,
    });
    // Trainer-only and app fields are never offered.
    expect(fields.some(field => field.id === "temperature")).toBe(false);
  });

  it("offers the time limit as the form keeps it, HH:MM:SS in its range", () => {
    const fields = readRevisableFields(form({ prompt: "Be Arjun.", maxTimeValue: "00:10:00" }));
    expect(JSON.parse(fields.find(field => field.id === SETTINGS_ID)!.value)).toEqual({
      maxTimeValue: "00:10:00",
    });
    expect(acceptSetting("maxTimeValue", "00:15:00")).toBe(true);
    expect(acceptSetting("maxTimeValue", "00:01:00")).toBe(false);
    expect(acceptSetting("maxTimeValue", "03:00:00")).toBe(false);
    expect(acceptSetting("maxTimeValue", 15)).toBe(false);
  });

  it("keeps only settings the form can hold", () => {
    expect(acceptSetting("difficultyLevel", "HARD")).toBe(true);
    expect(acceptSetting("difficultyLevel", "IMPOSSIBLE")).toBe(false);
    expect(acceptSetting("showScoreMeter", "no")).toBe(false);
    expect(acceptSetting("temperature", 0.2)).toBe(false);
  });
});
