import { describe, expect, it, vi } from "vitest";

// Neither barrel is loaded for real: both reach `@store` at module load.
vi.mock("@api", () => ({
  useEnhanceFieldMutation: () => [vi.fn()],
  useGetAvailableLanguageVoicesQuery: () => ({ data: [] }),
  useRevisePlanMutation: () => [vi.fn()],
}));
vi.mock("@constants", () => ({
  en: { agentBuilderRevision: { characterDetails: "Character details" } },
}));

import {
  CHARACTER_DETAILS_ID,
  describeCharacterChange,
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
